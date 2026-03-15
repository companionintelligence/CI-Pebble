/**
 * CI Digital Memory – Pebble Watch App (main.c)
 *
 * Provides a Pebble UI for querying the Companion Intelligence (CI) Digital
 * Memory server and interacting with an Ollama LLM agent via the paired phone.
 *
 * Architecture: Watch (C) ↔ Phone (PebbleKit JS) ↔ CI-Server / Ollama
 *
 * AppMessage keys (must match appinfo.json "appKeys" and pebble-js-app.js):
 *   KEY_COMMAND  0 – command code sent to phone
 *   KEY_QUERY    1 – optional text payload (question / query string)
 *   KEY_RESULT   2 – result string received from phone
 *   KEY_ERROR    3 – error string received from phone
 *   KEY_STATUS   4 – transient status text from phone (e.g. "Loading…")
 */

#include <pebble.h>

/* ---- AppMessage key constants ------------------------------------------- */
#define KEY_COMMAND 0
#define KEY_QUERY   1
#define KEY_RESULT  2
#define KEY_ERROR   3
#define KEY_STATUS  4

/* ---- Command values sent via KEY_COMMAND --------------------------------- */
#define CMD_FETCH_EVENTS 1
#define CMD_ASK_AGENT    2

/* ---- Persistent storage keys --------------------------------------------- */
#define PERSIST_KEY_LAST_RESULT 0

/* ---- Buffer sizes --------------------------------------------------------- */
#define MAX_RESULT_LEN 256

/* ---- Predefined agent questions ------------------------------------------ */
static const char *s_agent_questions[] = {
  "What are my top goals?",
  "Who did I meet last week?",
  "What are my upcoming events?",
  "Summarize my recent activity",
};
#define NUM_QUESTIONS ((int)(sizeof(s_agent_questions) / sizeof(s_agent_questions[0])))

/* ---- Windows ------------------------------------------------------------- */
static Window *s_main_window;
static Window *s_result_window;
static Window *s_question_window;

/* ---- Main menu ----------------------------------------------------------- */
static MenuLayer *s_main_menu;
static TextLayer *s_status_text;

/* ---- Result / scroll window ---------------------------------------------- */
static ScrollLayer *s_scroll_layer;
static TextLayer   *s_result_text;
static char         s_result_buf[MAX_RESULT_LEN];

/* ---- Question selection menu --------------------------------------------- */
static MenuLayer *s_question_menu;

/* ---- Forward declarations ------------------------------------------------ */
static void result_window_push(const char *text);
static void send_command(uint8_t cmd, const char *query);


/* ==========================================================================
   AppMessage callbacks
   ========================================================================== */

static void inbox_received_handler(DictionaryIterator *iter, void *context) {
  Tuple *result_tuple = dict_find(iter, KEY_RESULT);
  Tuple *error_tuple  = dict_find(iter, KEY_ERROR);
  Tuple *status_tuple = dict_find(iter, KEY_STATUS);

  if (status_tuple) {
    APP_LOG(APP_LOG_LEVEL_INFO, "Status: %s", status_tuple->value->cstring);
    if (s_status_text) {
      text_layer_set_text(s_status_text, status_tuple->value->cstring);
    }
  }

  if (result_tuple) {
    const char *result = result_tuple->value->cstring;
    APP_LOG(APP_LOG_LEVEL_INFO, "Result received (first 50 chars): %.50s", result);
    persist_write_string(PERSIST_KEY_LAST_RESULT, result);
    result_window_push(result);
  }

  if (error_tuple) {
    const char *err = error_tuple->value->cstring;
    APP_LOG(APP_LOG_LEVEL_ERROR, "Error received: %s", err);
    result_window_push(err);
  }
}

static void inbox_dropped_handler(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Inbox message dropped, reason: %d", (int)reason);
}

static void outbox_failed_handler(DictionaryIterator *iter,
                                   AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox send failed, reason: %d", (int)reason);
  if (s_status_text) {
    text_layer_set_text(s_status_text, "Send failed");
  }
}

static void outbox_sent_handler(DictionaryIterator *iter, void *context) {
  APP_LOG(APP_LOG_LEVEL_DEBUG, "Outbox message sent successfully");
}


/* ==========================================================================
   Communication helpers
   ========================================================================== */

/**
 * Send a command (and optional query string) to the phone companion app.
 */
static void send_command(uint8_t cmd, const char *query) {
  DictionaryIterator *iter;
  AppMessageResult result = app_message_outbox_begin(&iter);
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Failed to open outbox: %d", (int)result);
    return;
  }

  dict_write_uint8(iter, KEY_COMMAND, cmd);
  if (query) {
    dict_write_cstring(iter, KEY_QUERY, query);
  }

  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Failed to send message: %d", (int)result);
  } else {
    APP_LOG(APP_LOG_LEVEL_INFO, "Command %d sent to phone", (int)cmd);
    if (s_status_text) {
      text_layer_set_text(s_status_text, "Loading...");
    }
  }
}


/* ==========================================================================
   Result / scroll window
   ========================================================================== */

static void result_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  /* Text layer with auto-height for word-wrapping */
  s_result_text = text_layer_create(GRect(4, 4, bounds.size.w - 8, 2000));
  text_layer_set_font(s_result_text,
                      fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_overflow_mode(s_result_text, GTextOverflowModeWordWrap);
  text_layer_set_text(s_result_text, s_result_buf);

  /* Shrink layer to actual content height */
  GSize content_size = text_layer_get_content_size(s_result_text);
  text_layer_set_size(s_result_text, GSize(bounds.size.w - 8, content_size.h));

  /* Scroll layer wrapping the text */
  s_scroll_layer = scroll_layer_create(bounds);
  scroll_layer_set_click_config_onto_window(s_scroll_layer, window);
  scroll_layer_set_content_size(s_scroll_layer,
                                GSize(bounds.size.w, content_size.h + 8));
  scroll_layer_add_child(s_scroll_layer, text_layer_get_layer(s_result_text));
  layer_add_child(root, scroll_layer_get_layer(s_scroll_layer));
}

static void result_window_unload(Window *window) {
  scroll_layer_destroy(s_scroll_layer);
  text_layer_destroy(s_result_text);
  s_scroll_layer = NULL;
  s_result_text  = NULL;
}

/**
 * Copy text into the result buffer then push (or re-use) the result window.
 */
static void result_window_push(const char *text) {
  strncpy(s_result_buf, text, MAX_RESULT_LEN - 1);
  s_result_buf[MAX_RESULT_LEN - 1] = '\0';

  if (!s_result_window) {
    s_result_window = window_create();
    window_set_window_handlers(s_result_window, (WindowHandlers){
      .load   = result_window_load,
      .unload = result_window_unload,
    });
  }
  window_stack_push(s_result_window, true /* animated */);
}


/* ==========================================================================
   Question selection window
   ========================================================================== */

static uint16_t question_menu_num_rows(MenuLayer *menu_layer,
                                       uint16_t section_index, void *context) {
  return NUM_QUESTIONS;
}

static void question_menu_draw_row(GContext *ctx, const Layer *cell_layer,
                                   MenuIndex *cell_index, void *context) {
  menu_cell_basic_draw(ctx, cell_layer,
                       s_agent_questions[cell_index->row], NULL, NULL);
}

static void question_menu_select(MenuLayer *menu_layer, MenuIndex *cell_index,
                                  void *context) {
  const char *question = s_agent_questions[cell_index->row];
  APP_LOG(APP_LOG_LEVEL_INFO, "Question selected: %s", question);
  send_command(CMD_ASK_AGENT, question);
  window_stack_pop(true /* animated */);
}

static void question_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  s_question_menu = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_question_menu, NULL, (MenuLayerCallbacks){
    .get_num_rows = question_menu_num_rows,
    .draw_row     = question_menu_draw_row,
    .select_click = question_menu_select,
  });
  menu_layer_set_click_config_onto_window(s_question_menu, window);
  layer_add_child(root, menu_layer_get_layer(s_question_menu));
}

static void question_window_unload(Window *window) {
  menu_layer_destroy(s_question_menu);
  s_question_menu = NULL;
}

static void show_question_window(void) {
  if (!s_question_window) {
    s_question_window = window_create();
    window_set_window_handlers(s_question_window, (WindowHandlers){
      .load   = question_window_load,
      .unload = question_window_unload,
    });
  }
  window_stack_push(s_question_window, true /* animated */);
}


/* ==========================================================================
   Main menu window
   ========================================================================== */

#define MAIN_MENU_ITEM_RECALL  0
#define MAIN_MENU_ITEM_ASK_AI  1
#define MAIN_MENU_ITEM_CACHED  2
#define MAIN_MENU_ITEM_COUNT   3

static uint16_t main_menu_num_rows(MenuLayer *menu_layer,
                                   uint16_t section_index, void *context) {
  return MAIN_MENU_ITEM_COUNT;
}

static void main_menu_draw_row(GContext *ctx, const Layer *cell_layer,
                               MenuIndex *cell_index, void *context) {
  switch (cell_index->row) {
    case MAIN_MENU_ITEM_RECALL:
      menu_cell_basic_draw(ctx, cell_layer,
                           "Recall Memory", "Fetch recent events", NULL);
      break;
    case MAIN_MENU_ITEM_ASK_AI:
      menu_cell_basic_draw(ctx, cell_layer,
                           "Ask AI", "Chat with Ollama agent", NULL);
      break;
    case MAIN_MENU_ITEM_CACHED:
      menu_cell_basic_draw(ctx, cell_layer,
                           "Last Result", "View cached response", NULL);
      break;
    default:
      break;
  }
}

static void main_menu_select(MenuLayer *menu_layer, MenuIndex *cell_index,
                              void *context) {
  switch (cell_index->row) {
    case MAIN_MENU_ITEM_RECALL:
      send_command(CMD_FETCH_EVENTS, NULL);
      break;

    case MAIN_MENU_ITEM_ASK_AI:
      show_question_window();
      break;

    case MAIN_MENU_ITEM_CACHED: {
      char cached[MAX_RESULT_LEN];
      int bytes = persist_read_string(PERSIST_KEY_LAST_RESULT,
                                      cached, MAX_RESULT_LEN);
      if (bytes > 0) {
        result_window_push(cached);
      } else {
        result_window_push("No cached result.");
      }
      break;
    }

    default:
      break;
  }
}

static int16_t main_menu_cell_height(MenuLayer *menu_layer,
                                     MenuIndex *cell_index, void *context) {
  return 44;
}

static void main_window_load(Window *window) {
  Layer *root   = window_get_root_layer(window);
  GRect  bounds = layer_get_bounds(root);

  /* Status bar pinned to the bottom */
  s_status_text = text_layer_create(
      GRect(0, bounds.size.h - 18, bounds.size.w, 18));
  text_layer_set_font(s_status_text,
                      fonts_get_system_font(FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(s_status_text, GTextAlignmentCenter);
  text_layer_set_text(s_status_text, "CI Digital Memory");
  layer_add_child(root, text_layer_get_layer(s_status_text));

  /* Main menu above status bar */
  GRect menu_bounds = GRect(0, 0, bounds.size.w, bounds.size.h - 18);
  s_main_menu = menu_layer_create(menu_bounds);
  menu_layer_set_callbacks(s_main_menu, NULL, (MenuLayerCallbacks){
    .get_num_rows    = main_menu_num_rows,
    .draw_row        = main_menu_draw_row,
    .select_click    = main_menu_select,
    .get_cell_height = main_menu_cell_height,
  });
  menu_layer_set_click_config_onto_window(s_main_menu, window);
  layer_add_child(root, menu_layer_get_layer(s_main_menu));
}

static void main_window_unload(Window *window) {
  menu_layer_destroy(s_main_menu);
  text_layer_destroy(s_status_text);
  s_main_menu   = NULL;
  s_status_text = NULL;
}


/* ==========================================================================
   App lifecycle
   ========================================================================== */

static void init(void) {
  /* Register AppMessage callbacks */
  app_message_register_inbox_received(inbox_received_handler);
  app_message_register_inbox_dropped(inbox_dropped_handler);
  app_message_register_outbox_failed(outbox_failed_handler);
  app_message_register_outbox_sent(outbox_sent_handler);

  /* Open AppMessage with the maximum supported buffer sizes */
  app_message_open(app_message_inbox_size_maximum(),
                   app_message_outbox_size_maximum());

  /* Create and push the main window */
  s_main_window = window_create();
  window_set_window_handlers(s_main_window, (WindowHandlers){
    .load   = main_window_load,
    .unload = main_window_unload,
  });
  window_stack_push(s_main_window, true /* animated */);

  APP_LOG(APP_LOG_LEVEL_INFO, "CI Digital Memory app initialized");
}

static void deinit(void) {
  window_destroy(s_main_window);
  if (s_result_window)   { window_destroy(s_result_window);   }
  if (s_question_window) { window_destroy(s_question_window); }

  APP_LOG(APP_LOG_LEVEL_INFO, "CI Digital Memory app deinitialized");
}

int main(void) {
  init();
  app_event_loop();
  deinit();
  return 0;
}
