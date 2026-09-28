/**
 * Companion Memory for Pebble: watch app (main.c)
 *
 * Recall from, and ask questions against, your Companion Memory (CI-Server)
 * via the paired phone. The watch never talks to Ollama or any other backend
 * directly; see ../../docs/CI-Integration-Audit.md.
 *
 * Architecture: Watch (C) <-> Phone (PebbleKit JS) <-> CI-Server
 *
 * AppMessage keys (must match appinfo.json "appKeys" and pebble-js-app.js):
 *   KEY_COMMAND  0  command code sent to phone
 *   KEY_QUERY    1  optional text payload (question)
 *   KEY_RESULT   2  result string received from phone
 *   KEY_ERROR    3  error string received from phone
 *   KEY_STATUS   4  transient status text from phone
 *
 * Colours come from brand.h, generated from the CI-Common canon by
 * scripts/sync-brand.mjs. Pebble quantises them to its own palette at build
 * time, and black-and-white platforms fall back to black and white.
 */

#include <pebble.h>
#include "brand.h"

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
#define STATUS_LEN     32

/* ---- Brand colours ------------------------------------------------------- */
#define BRAND_PRIMARY    PBL_IF_COLOR_ELSE(GColorFromHEX(CI_LIGHT_PRIMARY), GColorBlack)
#define BRAND_ON_PRIMARY GColorWhite
#define BRAND_BACKGROUND GColorWhite
#define BRAND_TEXT       GColorBlack

/* ---- Result window layout constants -------------------------------------- */
/* Extra padding added to text layer height so the last line is never clipped
 * (text_layer_get_content_size may underestimate before the first render). */
#define TEXT_HEIGHT_PADDING   10
/* Additional vertical padding added on top of the text height when setting
 * the scroll layer's content size. */
#define SCROLL_CONTENT_PADDING 8

/* ---- Copy ---------------------------------------------------------------- */
#define STATUS_READY "Companion Memory"

/* ---- Predefined questions ------------------------------------------------
 * Short labels fit the 144 px screens; the full sentence is what gets asked. */
typedef struct {
  const char *label;
  const char *question;
} Question;

static const Question s_questions[] = {
  { "My goals",        "What are my top goals?" },
  { "Last week",       "Who did I meet last week?" },
  { "Coming up",       "What are my upcoming events?" },
  { "Recent activity", "Summarize my recent activity" },
};
#define NUM_QUESTIONS ((int)(sizeof(s_questions) / sizeof(s_questions[0])))

/* ---- Windows ------------------------------------------------------------- */
static Window *s_main_window;
static Window *s_result_window;
static Window *s_question_window;

/* ---- Main menu ----------------------------------------------------------- */
static MenuLayer *s_main_menu;
static char       s_status[STATUS_LEN] = STATUS_READY;

/* ---- Result / scroll window ---------------------------------------------- */
static ScrollLayer *s_scroll_layer;
static TextLayer   *s_result_text;
static char         s_result_buf[MAX_RESULT_LEN];

/* ---- Question selection menu --------------------------------------------- */
static MenuLayer *s_question_menu;

#if defined(PBL_MICROPHONE)
static DictationSession *s_dictation_session;
#endif

/* ---- Forward declarations ------------------------------------------------ */
static void result_window_push(const char *text);
static void send_command(uint8_t cmd, const char *query);


/* ==========================================================================
   Status line (the main menu header doubles as the status bar, so it also
   works on round screens where a bottom bar would be clipped)
   ========================================================================== */

static void set_status(const char *text) {
  strncpy(s_status, text, STATUS_LEN - 1);
  s_status[STATUS_LEN - 1] = '\0';
  if (s_main_menu) {
    layer_mark_dirty(menu_layer_get_layer(s_main_menu));
  }
}

static void style_menu(MenuLayer *menu) {
#if defined(PBL_COLOR)
  menu_layer_set_normal_colors(menu, BRAND_BACKGROUND, BRAND_TEXT);
  menu_layer_set_highlight_colors(menu, BRAND_PRIMARY, BRAND_ON_PRIMARY);
#endif
#if defined(PBL_ROUND)
  menu_layer_set_center_focused(menu, true);
#endif
}


/* ==========================================================================
   AppMessage callbacks
   ========================================================================== */

static void inbox_received_handler(DictionaryIterator *iter, void *context) {
  Tuple *result_tuple = dict_find(iter, KEY_RESULT);
  Tuple *error_tuple  = dict_find(iter, KEY_ERROR);
  Tuple *status_tuple = dict_find(iter, KEY_STATUS);

  if (status_tuple) {
    APP_LOG(APP_LOG_LEVEL_INFO, "Status: %s", status_tuple->value->cstring);
    set_status(status_tuple->value->cstring);
  }

  if (result_tuple) {
    const char *result = result_tuple->value->cstring;
    APP_LOG(APP_LOG_LEVEL_INFO, "Result received (first 50 chars): %.50s", result);
    persist_write_string(PERSIST_KEY_LAST_RESULT, result);
    set_status(STATUS_READY);
    vibes_short_pulse();
    result_window_push(result);
  }

  if (error_tuple) {
    const char *err = error_tuple->value->cstring;
    APP_LOG(APP_LOG_LEVEL_ERROR, "Error received: %s", err);
    set_status(STATUS_READY);
    result_window_push(err);
  }
}

static void inbox_dropped_handler(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Inbox message dropped, reason: %d", (int)reason);
}

static void outbox_failed_handler(DictionaryIterator *iter,
                                   AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox send failed, reason: %d", (int)reason);
  set_status("Phone unreachable");
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
    set_status("Phone busy, try again");
    return;
  }

  dict_write_uint8(iter, KEY_COMMAND, cmd);
  if (query) {
    dict_write_cstring(iter, KEY_QUERY, query);
  }

  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Failed to send message: %d", (int)result);
    set_status("Phone unreachable");
  } else {
    APP_LOG(APP_LOG_LEVEL_INFO, "Command %d sent to phone", (int)cmd);
    set_status("Asking your phone...");
  }
}


/* ==========================================================================
   Result / scroll window
   ========================================================================== */

/**
 * Resize the result text layer and update the scroll layer's content size to
 * match.  Called both from result_window_load (first render) and from
 * result_window_push when a new result arrives while the window is already
 * visible.
 */
static void result_update_sizing(GRect bounds) {
  GSize content_size = text_layer_get_content_size(s_result_text);
  int text_h = content_size.h + TEXT_HEIGHT_PADDING;
  text_layer_set_size(s_result_text, GSize(bounds.size.w - 8, text_h));
  scroll_layer_set_content_size(s_scroll_layer,
                                GSize(bounds.size.w,
                                      text_h + SCROLL_CONTENT_PADDING));
}

static void result_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  window_set_background_color(window, BRAND_BACKGROUND);

  /* Text layer with auto-height for word-wrapping */
  s_result_text = text_layer_create(GRect(4, 4, bounds.size.w - 8, 2000));
  text_layer_set_font(s_result_text,
                      fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_color(s_result_text, BRAND_TEXT);
  text_layer_set_background_color(s_result_text, GColorClear);
  text_layer_set_overflow_mode(s_result_text, GTextOverflowModeWordWrap);
  text_layer_set_text(s_result_text, s_result_buf);

  /* Scroll layer wrapping the text */
  s_scroll_layer = scroll_layer_create(bounds);
  scroll_layer_set_click_config_onto_window(s_scroll_layer, window);
  scroll_layer_add_child(s_scroll_layer, text_layer_get_layer(s_result_text));
  layer_add_child(root, scroll_layer_get_layer(s_scroll_layer));

#if defined(PBL_ROUND)
  /* Flow text inside the circle instead of clipping it at the edges. */
  text_layer_enable_screen_text_flow_and_paging(s_result_text, 8);
  scroll_layer_set_paging(s_scroll_layer, true);
#endif

  /* Size text and scroll layers to fit content */
  result_update_sizing(bounds);
}

static void result_window_unload(Window *window) {
  scroll_layer_destroy(s_scroll_layer);
  text_layer_destroy(s_result_text);
  s_scroll_layer = NULL;
  s_result_text  = NULL;
}

/**
 * Copy text into the result buffer then push (or re-use) the result window.
 *
 * If the result window is already on the stack (s_result_text is non-NULL),
 * update the text layer in-place and recalculate the scroll content size so
 * the new content is visible without re-pushing the window.
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

  if (s_result_text) {
    /* Window is already loaded/visible: update the text and resize in-place */
    text_layer_set_text(s_result_text, s_result_buf);
    Layer *root = window_get_root_layer(s_result_window);
    GRect bounds = layer_get_bounds(root);
    result_update_sizing(bounds);
    /* Scroll back to the top so the user sees the new result from the start */
    scroll_layer_set_content_offset(s_scroll_layer, GPointZero, true);
  } else {
    window_stack_push(s_result_window, true /* animated */);
  }
}


/* ==========================================================================
   Optional device services
   ========================================================================== */

#if defined(PBL_MICROPHONE)
static void dictation_session_callback(DictationSession *session,
                                       DictationSessionStatus status,
                                       char *transcription, void *context) {
  if (status == DictationSessionStatusSuccess && transcription &&
      transcription[0] != '\0') {
    send_command(CMD_ASK_AGENT, transcription);
  } else {
    /* DictationSessionStatusFailureTranscriptionRejected is what the SDK
     * reports when the user reviews the transcription and dismisses it.
     * Every other failure value (timeout, no speech, connectivity,
     * disabled, internal/recognizer error) is a real failure, not a
     * cancellation. */
    set_status(status == DictationSessionStatusFailureTranscriptionRejected
                   ? "Dictation canceled"
                   : "Dictation failed");
  }
}

static void start_dictation_session(void) {
  if (!s_dictation_session) {
    s_dictation_session = dictation_session_create(MAX_RESULT_LEN - 1,
                                                   dictation_session_callback,
                                                   NULL);
  }

  set_status("Listening...");
  dictation_session_start(s_dictation_session);
}
#endif


/* ==========================================================================
   Question selection window
   ========================================================================== */

static uint16_t question_menu_num_rows(MenuLayer *menu_layer,
                                       uint16_t section_index, void *context) {
#if defined(PBL_MICROPHONE)
  return NUM_QUESTIONS + 1;
#else
  return NUM_QUESTIONS;
#endif
}

static void question_menu_draw_row(GContext *ctx, const Layer *cell_layer,
                                   MenuIndex *cell_index, void *context) {
#if defined(PBL_MICROPHONE)
  if (cell_index->row == 0) {
    menu_cell_basic_draw(ctx, cell_layer, "Speak", "Use dictation", NULL);
    return;
  }
  const int question_index = cell_index->row - 1;
#else
  const int question_index = cell_index->row;
#endif

  menu_cell_basic_draw(ctx, cell_layer, s_questions[question_index].label, NULL, NULL);
}

static void question_menu_select(MenuLayer *menu_layer, MenuIndex *cell_index,
                                   void *context) {
#if defined(PBL_MICROPHONE)
  if (cell_index->row == 0) {
    window_stack_pop(true /* animated */);
    start_dictation_session();
    return;
  }
  const char *question = s_questions[cell_index->row - 1].question;
#else
  const char *question = s_questions[cell_index->row].question;
#endif

  APP_LOG(APP_LOG_LEVEL_INFO, "Question selected: %s", question);
  send_command(CMD_ASK_AGENT, question);
  window_stack_pop(true /* animated */);
}

static void question_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  window_set_background_color(window, BRAND_BACKGROUND);

  s_question_menu = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_question_menu, NULL, (MenuLayerCallbacks){
    .get_num_rows = question_menu_num_rows,
    .draw_row     = question_menu_draw_row,
    .select_click = question_menu_select,
  });
  style_menu(s_question_menu);
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
#define MAIN_MENU_ITEM_ASK     1
#define MAIN_MENU_ITEM_LAST    2
#define MAIN_MENU_ITEM_COUNT   3

static uint16_t main_menu_num_rows(MenuLayer *menu_layer,
                                   uint16_t section_index, void *context) {
  return MAIN_MENU_ITEM_COUNT;
}

static int16_t main_menu_header_height(MenuLayer *menu_layer,
                                       uint16_t section_index, void *context) {
  return MENU_CELL_BASIC_HEADER_HEIGHT;
}

static void main_menu_draw_header(GContext *ctx, const Layer *cell_layer,
                                  uint16_t section_index, void *context) {
  GRect bounds = layer_get_bounds(cell_layer);
  graphics_context_set_fill_color(ctx, BRAND_PRIMARY);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);
  graphics_context_set_text_color(ctx, BRAND_ON_PRIMARY);
  graphics_draw_text(ctx, s_status,
                     fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                     GRect(0, -1, bounds.size.w, bounds.size.h),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter, NULL);
}

/* Subtitles stay under about 20 characters so they fit the 144 px screens. */
static void main_menu_draw_row(GContext *ctx, const Layer *cell_layer,
                               MenuIndex *cell_index, void *context) {
  switch (cell_index->row) {
    case MAIN_MENU_ITEM_RECALL:
      menu_cell_basic_draw(ctx, cell_layer, "Recall", "Latest from Memory", NULL);
      break;
    case MAIN_MENU_ITEM_ASK:
      menu_cell_basic_draw(ctx, cell_layer, "Ask", "Search your Memory", NULL);
      break;
    case MAIN_MENU_ITEM_LAST:
      menu_cell_basic_draw(ctx, cell_layer, "Last answer", "Saved on this watch", NULL);
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

    case MAIN_MENU_ITEM_ASK:
      show_question_window();
      break;

    case MAIN_MENU_ITEM_LAST: {
      char saved[MAX_RESULT_LEN];
      int bytes = persist_read_string(PERSIST_KEY_LAST_RESULT,
                                      saved, MAX_RESULT_LEN);
      if (bytes > 0) {
        result_window_push(saved);
      } else {
        result_window_push("Nothing saved yet. Run Recall first.");
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

  window_set_background_color(window, BRAND_BACKGROUND);

  s_main_menu = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_main_menu, NULL, (MenuLayerCallbacks){
    .get_num_rows      = main_menu_num_rows,
    .get_header_height = main_menu_header_height,
    .draw_header       = main_menu_draw_header,
    .draw_row          = main_menu_draw_row,
    .select_click      = main_menu_select,
    .get_cell_height   = main_menu_cell_height,
  });
  style_menu(s_main_menu);
  menu_layer_set_click_config_onto_window(s_main_menu, window);
  layer_add_child(root, menu_layer_get_layer(s_main_menu));
}

static void main_window_unload(Window *window) {
  menu_layer_destroy(s_main_menu);
  s_main_menu = NULL;
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

  APP_LOG(APP_LOG_LEVEL_INFO, "Companion Memory app initialized");
}

static void deinit(void) {
#if defined(PBL_MICROPHONE)
  if (s_dictation_session) {
    dictation_session_destroy(s_dictation_session);
  }
#endif
  window_destroy(s_main_window);
  if (s_result_window)   { window_destroy(s_result_window);   }
  if (s_question_window) { window_destroy(s_question_window); }

  APP_LOG(APP_LOG_LEVEL_INFO, "Companion Memory app deinitialized");
}

int main(void) {
  init();
  app_event_loop();
  deinit();
  return 0;
}
