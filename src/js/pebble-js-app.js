/**
 * CI Digital Memory – PebbleKit JS Phone Companion (pebble-js-app.js)
 *
 * Runs on the paired phone and acts as a bridge between the Pebble watch and
 * CI-Server (the user's private Digital Memory appliance). CI-Server is the
 * ONLY service this companion talks to:
 *
 *   - It never calls Ollama directly. Ollama is CI-Server's own internal LLM
 *     backend; CI-Server owns model selection, tool-calling and conversation
 *     state, so a device client asks CI-Server, not the model runtime behind
 *     it.
 *   - It never calls CI-Hub. Hub is the appliance's local app runtime for
 *     installed marketplace apps; Server-to-Hub traffic is internal,
 *     signed service-to-service messaging, not a surface device clients use.
 *
 * See ../../docs/CI-Integration-Audit.md for how this file used to call
 * endpoints (`/api/events`, `/api/passive-log`, `/api/notifications`, and a
 * raw Ollama `/api/chat`) that never existed on CI-Server, and what changed.
 *
 * Architecture: Watch (C) <-> Phone (this file) <-> CI-Server
 *
 * AppMessage key constants (must match appinfo.json "appKeys" and main.c):
 *   KEY_COMMAND  0
 *   KEY_QUERY    1
 *   KEY_RESULT   2
 *   KEY_ERROR    3
 *   KEY_STATUS   4
 *
 * Command values:
 *   CMD_FETCH_EVENTS  1  – ask CI-Server to recall recent memory
 *   CMD_ASK_AGENT     2  – ask CI-Server a natural-language question against memory
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
var STORAGE_CI_HOST   = 'ci_host';
var STORAGE_API_KEY   = 'ci_api_key';
var STORAGE_DEVICE_ID = 'ci_device_id';
var STORAGE_CACHE_KEY = 'last_result';

/* ---- Defaults (user can override via localStorage from a config page) ---- */
var DEFAULT_CI_HOST = 'https://ci-server.local';

/* ---- CI-Server endpoints (mirrors appinfo.json's "companyName" appliance) -
 * All three are real, guarded REST routes on CI-Server (NestJS). The gateway
 * strips the "/api/" prefix before it reaches the app, so these are the
 * literal controller paths with "/api" put back on for clients. -------------
 */
var MEMORY_RECALL_PATH = '/api/memory/recall';
var DEVICES_PATH       = '/api/devices';
var POSITION_PATH      = '/api/position';

/* ---- This app's own identity, sent when registering as a Device ---------- */
var DEVICE_TYPE = 'smartwatch';
var DEVICE_NAME = 'Pebble Watch';
/* Keep in sync with appinfo.json "versionLabel". */
var APP_VERSION = '1.0';

/* ---- memory.recall request limits (mirrors CI-Server's recallSchema) ----- */
var RECALL_QUERY_MAX_LEN  = 2000;
var RECALL_MAX_RESULTS    = 5;
var DEFAULT_RECALL_QUERY  = 'Summarize what happened recently and anything I should know about right now.';

/* ---- Request timeout values (ms) ---------------------------------------- */
var CI_TIMEOUT       = 15000;
var DEVICE_TIMEOUT   = 8000;
var POSITION_TIMEOUT = 8000;

/* ---- Maximum characters to send in a single AppMessage ------------------- */
var MAX_MSG_LEN = 252;

/* ---- Background task cadence (ms) ---------------------------------------- */
var PASSIVE_LOG_INTERVAL   = 15 * 60 * 1000;
var LOCATION_CACHE_MAX_AGE = 60 * 1000;

var passiveLogTimer = null;


/* ==========================================================================
   Configuration helpers
   ========================================================================== */

function getCIHost() {
  return normalizeBaseURL(localStorage.getItem(STORAGE_CI_HOST) || DEFAULT_CI_HOST);
}

function getApiKey() {
  return trimString(localStorage.getItem(STORAGE_API_KEY) || '');
}

function getDeviceId() {
  return trimString(localStorage.getItem(STORAGE_DEVICE_ID) || '') || null;
}

function trimString(value) {
  return String(value || '').replace(/^\s+|\s+$/g, '');
}

function normalizeBaseURL(url) {
  return trimString(url).replace(/\/+$/, '');
}

function joinURL(base, path) {
  return normalizeBaseURL(base) + path;
}

function escapeHTML(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function saveSetting(key, value, normalizer) {
  var nextValue = normalizer ? normalizer(value) : trimString(value);
  if (nextValue) {
    localStorage.setItem(key, nextValue);
  } else {
    localStorage.removeItem(key);
  }
}

/**
 * CI-Server's ApiKeyStrategy reads `x-api-key` first and only falls back to
 * `Authorization: Bearer <key>` for callers (like MCP clients) that cannot
 * send a custom header. This companion can set custom headers, so it always
 * sends the canonical form.
 */
function setAuthHeader(xhr) {
  var key = getApiKey();
  if (key) {
    xhr.setRequestHeader('x-api-key', key);
  }
}

function buildConfigurationPage() {
  return '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>CI Memory Settings</title>' +
    '<style>' +
    'body{font-family:sans-serif;padding:16px;background:#f3f3f3;color:#222;}' +
    'label{display:block;font-size:12px;font-weight:bold;margin:12px 0 4px;}' +
    'input{box-sizing:border-box;width:100%;padding:10px;border:1px solid #bbb;border-radius:4px;}' +
    'button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:4px;background:#0055ff;color:#fff;font-size:16px;}' +
    'p{font-size:12px;line-height:1.4;color:#555;}' +
    '</style></head><body>' +
    '<h2>CI Digital Memory</h2>' +
    '<p>Configure your CI-Server appliance URL and API key. Create the key on ' +
    'CI-Server under Settings &rarr; API Keys with the <b>memory</b> scope enabled ' +
    '&mdash; that scope is required for both Recall Memory and Ask AI.</p>' +
    '<label for="ci_host">CI-Server URL</label>' +
    '<input id="ci_host" type="url" value="' + escapeHTML(getCIHost()) + '">' +
    '<label for="ci_api_key">CI-Server API key</label>' +
    '<input id="ci_api_key" type="password" autocomplete="off" value="' + escapeHTML(getApiKey()) + '">' +
    '<button id="save">Save</button>' +
    '<script>(function(){' +
    'function value(id){return document.getElementById(id).value;}' +
    'document.getElementById("save").addEventListener("click", function(){' +
    'var payload={' +
    'ci_host:value("ci_host"),' +
    'ci_api_key:value("ci_api_key")' +
    '};' +
    'document.location="pebblejs://close#" + encodeURIComponent(JSON.stringify(payload));' +
    '});' +
    '}());<\/script></body></html>';
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
   CI-Server device registration
   ========================================================================== */

/**
 * Register this phone/watch pair as a Device on CI-Server (POST /api/devices,
 * device_type "smartwatch" — a first-class value in CI-Server's schema) and
 * cache the server-assigned device_id. Best-effort: recall/ask/position all
 * work without a device_id (it is optional everywhere it is used), so a
 * failure here is logged, not surfaced to the watch.
 */
function registerDeviceIfNeeded() {
  if (getDeviceId() || !getApiKey()) {
    return;
  }

  var url = joinURL(getCIHost(), DEVICES_PATH);
  var xhr = new XMLHttpRequest();
  xhr.timeout = DEVICE_TIMEOUT;
  xhr.open('POST', url, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  setAuthHeader(xhr);

  xhr.onload = function() {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        var device = JSON.parse(xhr.responseText);
        if (device && device.device_id) {
          localStorage.setItem(STORAGE_DEVICE_ID, device.device_id);
          console.log('Registered as CI-Server device ' + device.device_id);
        }
      } catch (e) {
        console.log('Device registration response parse error: ' + e);
      }
    } else {
      console.log('Device registration failed: ' + xhr.status);
    }
  };

  xhr.onerror = function() {
    console.log('Device registration network error');
  };

  xhr.ontimeout = function() {
    console.log('Device registration timed out');
  };

  try {
    xhr.send(JSON.stringify({
      device_type: DEVICE_TYPE,
      device_name: DEVICE_NAME,
      app_version: APP_VERSION
    }));
  } catch (e) {
    console.log('Failed to send device registration: ' + e);
  }
}

/**
 * Best-effort heartbeat. Never blocks or reports failure to the watch.
 */
function touchDevice() {
  var deviceId = getDeviceId();
  if (!deviceId || !getApiKey()) {
    return;
  }

  var url = joinURL(getCIHost(), DEVICES_PATH) + '/' + encodeURIComponent(deviceId) + '/last-seen';
  var xhr = new XMLHttpRequest();
  xhr.timeout = DEVICE_TIMEOUT;
  xhr.open('PATCH', url, true);
  setAuthHeader(xhr);
  xhr.onerror = function() { console.log('Device heartbeat network error'); };

  try {
    xhr.send();
  } catch (e) {
    console.log('Failed to send device heartbeat: ' + e);
  }
}


/* ==========================================================================
   CI-Server memory recall (Recall Memory + Ask AI both use this)
   ========================================================================== */

/**
 * POST /api/memory/recall — a per-turn hybrid (keyword/semantic) search
 * against the user's CI-Server knowledge graph. Returns a markdown-formatted
 * `block` of the matched memory content plus a `resultCount`. This is a
 * plain JSON request/response (no streaming), which is what makes it usable
 * from PebbleKit JS's XHR — CI-Server's own chat/generate endpoint streams a
 * custom binary frame protocol meant for its web/mobile UI, not headless
 * device clients (see docs/CI-Integration-Audit.md).
 *
 * "Ask AI" is therefore a recall over memory, not open-ended LLM chat: the
 * watch shows retrieved memory content relevant to the question, not a
 * generated conversational reply.
 */
function recallMemory(query, statusText) {
  var trimmedQuery = trimString(query).substring(0, RECALL_QUERY_MAX_LEN);
  if (!trimmedQuery) {
    sendErrorToWatch('Empty question');
    return;
  }

  var url = joinURL(getCIHost(), MEMORY_RECALL_PATH);
  console.log('Recalling memory from: ' + url);
  sendStatusToWatch(statusText || 'Thinking...');

  var xhr = new XMLHttpRequest();
  xhr.timeout = CI_TIMEOUT;

  xhr.onload = function() {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        var data = JSON.parse(xhr.responseText);
        var summary = formatRecallResult(data);
        cacheResult(summary);
        sendResultToWatch(summary);
        touchDevice();
      } catch (e) {
        console.log('JSON parse error: ' + e + '\nResponse: ' + xhr.responseText.substring(0, 200));
        sendErrorToWatch('Parse error');
      }
    } else if (xhr.status === 401 || xhr.status === 403) {
      console.log('CI-Server auth error: ' + xhr.status);
      sendErrorToWatch('Check API key/scope');
    } else {
      console.log('HTTP error: ' + xhr.status + ' ' + xhr.statusText);
      sendErrorToWatch('Server error: ' + xhr.status);
    }
  };

  xhr.onerror = function() {
    console.log('Network error calling CI-Server');
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

  xhr.open('POST', url, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  setAuthHeader(xhr);

  try {
    xhr.send(JSON.stringify({
      query: trimmedQuery,
      maxResults: RECALL_MAX_RESULTS
    }));
  } catch (e) {
    console.log('Failed to send recall request: ' + e);
    sendErrorToWatch('Request failed');
  }
}

function formatRecallResult(data) {
  var block = (data && data.block) ? String(data.block) : '';
  var resultCount = data && typeof data.resultCount === 'number' ? data.resultCount : null;

  if (!block || resultCount === 0) {
    return 'Nothing relevant found in memory.';
  }

  return block;
}

function fetchMemoryEvents() {
  recallMemory(DEFAULT_RECALL_QUERY, 'Fetching...');
}

function askMemory(question) {
  recallMemory(question, 'Thinking...');
}


/* ==========================================================================
   Passive location logging (POST /api/position)
   ========================================================================== */

/**
 * Build a single CreatePositionDto (CI-Server's real position schema) from a
 * browser GeolocationPosition. There is no watch-side telemetry (like step
 * counts) folded in here — CI-Server has no ingestion endpoint for that; see
 * docs/CI-Integration-Audit.md.
 */
function buildPositionEntry(position) {
  var entry = {
    time: new Date().toISOString()
  };

  var deviceId = getDeviceId();
  if (deviceId) {
    entry.device_id = deviceId;
  }

  if (position && position.coords) {
    entry.location = {
      x: position.coords.longitude,
      y: position.coords.latitude
    };
    if (typeof position.coords.accuracy === 'number') {
      entry.accuracy_meters = Math.max(position.coords.accuracy, 0.01);
    }
  }

  return entry;
}

function postPosition(entry) {
  var url = joinURL(getCIHost(), POSITION_PATH);
  var xhr = new XMLHttpRequest();

  xhr.timeout = POSITION_TIMEOUT;
  xhr.open('POST', url, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  setAuthHeader(xhr);

  xhr.onload = function() {
    if (xhr.status >= 200 && xhr.status < 300) {
      console.log('Position uploaded');
      touchDevice();
    } else {
      console.log('Position upload failed: ' + xhr.status);
    }
  };

  xhr.onerror = function() {
    console.log('Position upload network error');
  };

  xhr.ontimeout = function() {
    console.log('Position upload timed out');
  };

  try {
    xhr.send(JSON.stringify([entry]));
  } catch (e) {
    console.log('Failed to send position: ' + e);
  }
}

function sendPassiveLog() {
  var nav = typeof navigator !== 'undefined' ? navigator : null;
  var geolocation = nav && nav.geolocation;

  if (!geolocation || !geolocation.getCurrentPosition) {
    console.log('Geolocation unavailable; skipping passive location log');
    return;
  }

  geolocation.getCurrentPosition(
    function(position) {
      postPosition(buildPositionEntry(position));
    },
    function(error) {
      console.log('Geolocation unavailable: ' + (error && error.message ? error.message : error));
    },
    {
      enableHighAccuracy: false,
      maximumAge: LOCATION_CACHE_MAX_AGE,
      timeout: 5000
    }
  );
}

function schedulePassiveLog() {
  if (passiveLogTimer) {
    clearTimeout(passiveLogTimer);
  }

  passiveLogTimer = setTimeout(function() {
    sendPassiveLog();
    schedulePassiveLog();
  }, PASSIVE_LOG_INTERVAL);
}

function restartBackgroundTasks() {
  registerDeviceIfNeeded();
  sendPassiveLog();
  schedulePassiveLog();
}


/* ==========================================================================
   Pebble event listeners
   ========================================================================== */

Pebble.addEventListener('ready', function() {
  console.log('PebbleKit JS ready');

  if (!localStorage.getItem(STORAGE_CI_HOST)) {
    console.log('No CI host configured; using default: ' + DEFAULT_CI_HOST);
  }
  if (!getApiKey()) {
    console.log('No CI-Server API key configured yet; open settings to add one.');
  }

  restartBackgroundTasks();
});

Pebble.addEventListener('showConfiguration', function() {
  Pebble.openURL('data:text/html;charset=utf-8,' +
                 encodeURIComponent(buildConfigurationPage()));
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e || !e.response || e.response === 'CANCELLED') {
    return;
  }

  try {
    var settings = JSON.parse(decodeURIComponent(e.response));
    var previousCIHost = getCIHost();
    var nextCIHost = normalizeBaseURL(settings.ci_host);
    saveSetting(STORAGE_CI_HOST, settings.ci_host, normalizeBaseURL);
    saveSetting(STORAGE_API_KEY, settings.ci_api_key, trimString);
    if (nextCIHost !== previousCIHost) {
      /* A device_id registered against the old host is meaningless here. */
      localStorage.removeItem(STORAGE_DEVICE_ID);
    }
    restartBackgroundTasks();
  } catch (err) {
    console.log('Configuration parse error: ' + err);
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
      askMemory(question);
      break;
    }

    default:
      console.log('Unknown command: ' + command);
      sendErrorToWatch('Unknown command');
      break;
  }
});
