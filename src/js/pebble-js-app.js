/**
 * CI Digital Memory – PebbleKit JS Phone Companion (pebble-js-app.js)
 *
 * Runs on the paired phone and acts as a bridge between the Pebble watch and:
 *   • CI-Server  – REST API for the user's private Digital Memory archive
 *   • Ollama LLM – local language model API for AI-powered answers
 *
 * Architecture: Watch (C) ↔ Phone (this file) ↔ CI-Server / Ollama
 *
 * AppMessage key constants (must match appinfo.json "appKeys" and main.c):
 *   KEY_COMMAND  0
 *   KEY_QUERY    1
 *   KEY_RESULT   2
 *   KEY_ERROR    3
 *   KEY_STATUS   4
 *
 * Command values:
 *   CMD_FETCH_EVENTS  1  – fetch recent memory events from CI-Server
 *   CMD_ASK_AGENT     2  – send a natural-language question to Ollama
 */

/* ---- AppMessage key constants ------------------------------------------- */
var KEY_COMMAND = 0;
var KEY_QUERY   = 1;
var KEY_RESULT  = 2;
var KEY_ERROR   = 3;
var KEY_STATUS  = 4;

/* ---- Command values ------------------------------------------------------ */
var CMD_FETCH_EVENTS = 1;
var CMD_ASK_AGENT    = 2;

/* ---- localStorage keys --------------------------------------------------- */
var STORAGE_CI_HOST    = 'ci_host';
var STORAGE_AUTH_TOKEN = 'ci_auth_token';
var STORAGE_OLLAMA_URL = 'ollama_url';
var STORAGE_CACHE_KEY  = 'last_result';

/* ---- Defaults (user can override via localStorage from a config page) ---- */
var DEFAULT_CI_HOST    = 'https://ci-server.local';
var DEFAULT_OLLAMA_URL = 'http://localhost:11434';

/* ---- LLM model to use (matches CI-Server .env OLLAMA_HOST setting) ------- */
var OLLAMA_MODEL = 'gemma3';

/* ---- Request timeout values (ms) ---------------------------------------- */
var CI_TIMEOUT     = 10000;
var OLLAMA_TIMEOUT = 30000;

/* ---- Maximum characters to send in a single AppMessage ------------------- */
var MAX_MSG_LEN = 252;


/* ==========================================================================
   Configuration helpers
   ========================================================================== */

function getCIHost() {
  return localStorage.getItem(STORAGE_CI_HOST) || DEFAULT_CI_HOST;
}

function getOllamaURL() {
  return localStorage.getItem(STORAGE_OLLAMA_URL) || DEFAULT_OLLAMA_URL;
}

function getAuthToken() {
  return localStorage.getItem(STORAGE_AUTH_TOKEN) || '';
}

function cacheResult(result) {
  try {
    localStorage.setItem(STORAGE_CACHE_KEY, result);
  } catch (e) {
    console.log('Failed to cache result: ' + e);
  }
}


/* ==========================================================================
   Watch communication helpers
   ========================================================================== */

/**
 * Truncate a string to MAX_MSG_LEN characters so it fits in an AppMessage.
 */
function truncate(str) {
  if (str.length > MAX_MSG_LEN) {
    return str.substring(0, MAX_MSG_LEN - 3) + '...';
  }
  return str;
}

/**
 * Send a result string back to the watch.
 */
function sendResultToWatch(result) {
  var msg = {};
  msg[KEY_RESULT] = truncate(result);
  Pebble.sendAppMessage(
    msg,
    function() { console.log('Result sent to watch'); },
    function(e) { console.log('sendAppMessage failed: ' + JSON.stringify(e)); }
  );
}

/**
 * Send an error string back to the watch.
 */
function sendErrorToWatch(msg) {
  var payload = {};
  payload[KEY_ERROR] = truncate(msg);
  Pebble.sendAppMessage(
    payload,
    function() { console.log('Error sent to watch: ' + msg); },
    function(e) { console.log('sendAppMessage (error) failed: ' + JSON.stringify(e)); }
  );
}

/**
 * Send a transient status string to the watch (shown in the status bar).
 */
function sendStatusToWatch(status) {
  var payload = {};
  payload[KEY_STATUS] = truncate(status);
  Pebble.sendAppMessage(
    payload,
    function() {},
    function(e) { console.log('sendAppMessage (status) failed: ' + JSON.stringify(e)); }
  );
}


/* ==========================================================================
   CI-Server integration
   ========================================================================== */

/**
 * Format an array of event objects into a compact string for watch display.
 * Shows at most 5 events (watch screen is small).
 */
function formatEvents(events) {
  if (!events || events.length === 0) {
    return 'No recent events found.';
  }

  var maxEvents = Math.min(events.length, 5);
  var lines = [];

  for (var i = 0; i < maxEvents; i++) {
    var ev = events[i];
    var line = '';

    if (ev.timestamp) {
      try {
        var d = new Date(ev.timestamp);
        /* getMonth() returns 0-based month (0 = January), so add 1 */
        line += (d.getMonth() + 1) + '/' + d.getDate() + ': ';
      } catch (e) {
        /* ignore date parse errors */
      }
    }

    line += ev.description || ev.notes || ev.title || ev.type || '(event)';
    lines.push(line);
  }

  if (events.length > maxEvents) {
    lines.push('…+' + (events.length - maxEvents) + ' more');
  }

  return lines.join('\n');
}

/**
 * Fetch recent memory events from the CI-Server and relay a summary to
 * the watch.  Falls back to the locally cached result on network failure.
 */
function fetchMemoryEvents() {
  var url = getCIHost() + '/api/events';
  console.log('Fetching events from: ' + url);
  sendStatusToWatch('Fetching...');

  var xhr = new XMLHttpRequest();
  xhr.timeout = CI_TIMEOUT;

  xhr.onload = function() {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        var data = JSON.parse(xhr.responseText);
        var events = Array.isArray(data) ? data : (data.events || []);
        var summary = formatEvents(events);
        cacheResult(summary);
        sendResultToWatch(summary);
      } catch (e) {
        console.log('JSON parse error: ' + e + '\nResponse: ' + xhr.responseText.substring(0, 200));
        sendErrorToWatch('Parse error');
      }
    } else {
      console.log('HTTP error: ' + xhr.status + ' ' + xhr.statusText);
      sendErrorToWatch('Server error: ' + xhr.status);
    }
  };

  xhr.onerror = function() {
    console.log('Network error fetching events');
    var cached = localStorage.getItem(STORAGE_CACHE_KEY);
    if (cached) {
      sendResultToWatch('[Cached] ' + cached);
    } else {
      sendErrorToWatch('Network error');
    }
  };

  xhr.ontimeout = function() {
    console.log('CI-Server request timed out');
    sendErrorToWatch('Request timed out');
  };

  xhr.open('GET', url, true);

  var token = getAuthToken();
  if (token) {
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
  }

  try {
    xhr.send();
  } catch (e) {
    console.log('Failed to send XHR: ' + e);
    sendErrorToWatch('Request failed');
  }
}


/* ==========================================================================
   Ollama LLM integration
   ========================================================================== */

/**
 * Send a natural-language question to the Ollama /api/chat endpoint and
 * relay the assistant's reply back to the watch.
 *
 * @param {string} question – question typed/selected on the watch
 */
function askOllamaAgent(question) {
  var url = getOllamaURL() + '/api/chat';
  console.log('Asking Ollama (' + OLLAMA_MODEL + '): ' + question);
  sendStatusToWatch('Thinking...');

  var payload = JSON.stringify({
    model: OLLAMA_MODEL,
    stream: false,
    messages: [
      {
        role: 'system',
        content: 'You are a concise personal assistant. Keep your answer under 200 characters as it will be shown on a Pebble smartwatch screen.'
      },
      {
        role: 'user',
        content: question
      }
    ]
  });

  var xhr = new XMLHttpRequest();
  xhr.timeout = OLLAMA_TIMEOUT;

  xhr.onload = function() {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        var data = JSON.parse(xhr.responseText);
        var answer;

        /* /api/chat response: { message: { role, content }, … } */
        if (data.message && data.message.content) {
          answer = data.message.content;
        /* /api/generate response: { response: "…", … }          */
        } else if (data.response) {
          answer = data.response;
        } else {
          answer = JSON.stringify(data).substring(0, 200);
        }

        console.log('Ollama answer: ' + answer);
        cacheResult(answer);
        sendResultToWatch(answer);
      } catch (e) {
        console.log('JSON parse error for Ollama response: ' + e);
        sendErrorToWatch('Parse error');
      }
    } else {
      console.log('Ollama HTTP error: ' + xhr.status);
      sendErrorToWatch('LLM error: ' + xhr.status);
    }
  };

  xhr.onerror = function() {
    console.log('Network error reaching Ollama');
    sendErrorToWatch('LLM unavailable');
  };

  xhr.ontimeout = function() {
    console.log('Ollama request timed out');
    sendErrorToWatch('LLM timed out');
  };

  xhr.open('POST', url, true);
  xhr.setRequestHeader('Content-Type', 'application/json');

  try {
    xhr.send(payload);
  } catch (e) {
    console.log('Failed to send Ollama request: ' + e);
    sendErrorToWatch('Request failed');
  }
}


/* ==========================================================================
   Pebble event listeners
   ========================================================================== */

Pebble.addEventListener('ready', function() {
  console.log('PebbleKit JS ready');

  if (!localStorage.getItem(STORAGE_CI_HOST)) {
    console.log('No CI host configured; using default: ' + DEFAULT_CI_HOST);
  }
  if (!localStorage.getItem(STORAGE_OLLAMA_URL)) {
    console.log('No Ollama URL configured; using default: ' + DEFAULT_OLLAMA_URL);
  }
});

Pebble.addEventListener('appmessage', function(e) {
  var payload = e.payload;
  console.log('AppMessage received: ' + JSON.stringify(payload));

  var command = payload[KEY_COMMAND];

  switch (command) {
    case CMD_FETCH_EVENTS:
      fetchMemoryEvents();
      break;

    case CMD_ASK_AGENT: {
      var question = payload[KEY_QUERY] || 'What are my recent activities?';
      askOllamaAgent(question);
      break;
    }

    default:
      console.log('Unknown command: ' + command);
      sendErrorToWatch('Unknown command');
      break;
  }
});
