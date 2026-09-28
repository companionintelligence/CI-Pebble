/**
 * Companion Memory for Pebble: PebbleKit JS phone companion (pebble-js-app.js)
 *
 * Runs on the paired phone and bridges the watch to CI-Server, your Companion
 * Memory. CI-Server is the only service this companion talks to:
 *
 *   - It never calls Ollama directly. Ollama is CI-Server's own LLM backend.
 *   - It never calls CI-Hub. Hub is the appliance's app runtime; Server to Hub
 *     traffic is internal, signed service traffic, not a device surface.
 *
 * See ../../docs/CI-Integration-Audit.md for what this file used to call and why
 * it changed.
 *
 * Architecture: Watch (C) <-> Phone (this file) <-> CI-Server
 *
 * AppMessage keys (must match appinfo.json "appKeys" and main.c):
 *   KEY_COMMAND 0, KEY_QUERY 1, KEY_RESULT 2, KEY_ERROR 3, KEY_STATUS 4
 *
 * Commands: CMD_FETCH_EVENTS 1 (recall), CMD_ASK_AGENT 2 (ask a question)
 *
 * API keys: CI-Server denies a scope-limited key on any route that does not
 * declare its scope. The `memory` scope reaches Recall and Ask. Device
 * registration and location upload have no scope yet, so they need an
 * unrestricted key; on a 403 this file stops trying and says so in the
 * settings page instead of failing quietly every 15 minutes.
 *
 * ES5 only: PebbleKit JS on older phones cannot parse anything newer.
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
var STORAGE_CI_HOST         = 'ci_host';
var STORAGE_API_KEY         = 'ci_api_key';
var STORAGE_DEVICE_ID       = 'ci_device_id';
var STORAGE_CACHE_KEY       = 'last_result';
var STORAGE_LOCATION_SYNC   = 'location_sync';
var STORAGE_DEVICE_BLOCKED  = 'device_blocked';
var STORAGE_POSITION_BLOCKED = 'position_blocked';
var STORAGE_LAST_CHECK      = 'last_check';

/* BEGIN GENERATED brand (scripts/sync-brand.mjs, tokens 1.0.0). Do not edit. */
var CI_BRAND_LIGHT_CSS = "--background:#f3faf7;--foreground:#0a222e;--card:#f0f9f5;--primary:#0a6358;--primary-foreground:#f0fdf4;--muted:#e8f2ec;--muted-foreground:#3a524b;--border:#dfece6;--destructive:#ee3533;--success:#0f5132;--warning:#855500";
var CI_BRAND_DARK_CSS = "--background:#041620;--foreground:#e8f2f4;--card:#0c323c;--primary:#c5e8dc;--primary-foreground:#041620;--muted:#073038;--muted-foreground:#a3babf;--border:#073038;--destructive:#ef7070;--success:#34d399;--warning:#fbbf24";
var CI_BRAND_MARK_SVG = "<svg id=\"Layer_1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"28 28 80 80\"><defs><style>.cls-1{fill:#066c80;}.cls-2{fill:#00a9a7;}.cls-3{fill:#72ddd4;}</style></defs><path class=\"cls-1\" d=\"M28.351,69.237l25.955-.131c.009.155.061.708.079.928.335,4.055,1.681,7.891,3.962,11.239.323.475,1.037,1.366,1.201,1.571,0,0,.067.115.066.115-.041.041-.379.202-.466.238-7.35,3.08-14.473,6.648-21.506,10.381-5.899-6.623-9.167-15.454-9.292-24.341Z\"/><path class=\"cls-1\" d=\"M59.19,53.501c-.066.077-.077.11-.147.197-.285.358-1.132,1.55-1.453,2.074-1.814,2.967-2.901,6.427-3.205,9.896-.052.596-.078,1.193-.086,1.804l-25.996.09c-.047-8.767,2.835-17.587,8.505-24.264.239-.061,3.864,1.914,4.418,2.187,4.148,2.044,8.349,4.049,12.597,5.878,1.728.744,3.593,1.524,5.365,2.137Z\"/><path class=\"cls-1\" d=\"M38.881,40.883c5.376-5.796,12.61-10.214,20.44-11.766.424-.084,1.906-.436,2.182-.169,3.051,5.12,6.631,9.929,10.687,14.296.109.118,1.33,1.244,1.259,1.301-4.933.793-8.926,3.445-12.472,6.799-.272.258-.674.735-.713.731-7.55-2.951-15.018-6.465-22.171-10.261-.015-.064.674-.809.788-.933Z\"/><path class=\"cls-1\" d=\"M41.819,97.926c-.982-.891-1.944-1.878-2.808-2.866l.089-.167c7.058-3.792,14.213-7.426,21.646-10.443.15.127.761.682.974.882,3.427,3.228,7.808,5.568,12.463,6.436-.074.123-1.283,1.352-1.702,1.822-3.756,4.208-6.947,9.03-9.792,13.891-.044.089-.107.118-.201.136-.349.067-1.951-.273-2.409-.363-6.823-1.347-13.138-4.676-18.26-9.328Z\"/><path class=\"cls-1\" d=\"M92.007,47.99c-.094.096-1.412-.82-1.623-.938-4.437-2.48-9.539-3.347-14.583-2.884-4.823-4.575-8.747-9.996-12.261-15.619.057-.082.11-.109.208-.126.271-.046.854-.067,1.172-.087,8.994-.572,17.784,1.612,25.182,6.737.538.373,1.677,1.099,2.077,1.534.073.079.157.138.164.26-.478,3.687-.828,7.416-.336,11.123Z\"/><path class=\"cls-1\" d=\"M64.714,107.951c-.059-.053.523-.985.603-1.118,3.175-5.255,6.868-10.417,11.239-14.71,4.432.04,8.851-.356,12.865-2.335l3.089-1.739c-.435,3.715.007,7.452.59,11.122-.028.181-.182.267-.298.38-.569.553-1.561,1.249-2.228,1.719-7.554,5.327-16.648,7.398-25.86,6.681Z\"/><path class=\"cls-2\" d=\"M56.4,69.069l16.209-.084c.069,2.981,1.034,5.661,2.702,8.089.108.157.692.779.573.897-4.957.808-9.707,2.527-14.39,4.277-3.162-3.656-4.91-8.334-5.094-13.178Z\"/><path class=\"cls-2\" d=\"M56.4,67.474c-.028-4.778,1.613-9.487,4.593-13.191,4.796,1.593,9.603,3.371,14.639,4.037.023.122-.022.206-.066.311-.239.572-1.055,1.517-1.405,2.206-.993,1.955-1.54,4.274-1.551,6.469l-16.209.168Z\"/><path class=\"cls-1\" d=\"M107.712,68.733c.214,10.94-4.637,21.662-12.722,28.89-.121.002-.355-2.174-.378-2.395-.211-2.023-.346-4.273-.168-6.297.051-.583.296-2.657.614-3.04.437-.527,1.269-1.144,1.78-1.705,3.83-4.198,6.166-9.704,6.087-15.453h4.787Z\"/><path class=\"cls-1\" d=\"M102.924,67.138c-.092-6.62-3.385-12.885-8.36-17.127-1.124-3.727-.715-7.863-.373-11.697.089.049.186.123.27.189.617.486,2.662,2.643,3.636,3.776,5.991,6.97,9.437,15.499,9.615,24.776l-4.788.084Z\"/><path class=\"cls-2\" d=\"M84.704,52.463c.005.003-.115.039-.204.071-.539.196-1.087.313-1.644.54-1.372.56-2.762,1.376-3.943,2.272-.392.297-1.472,1.379-1.774,1.501-.437.177-2.37-.283-2.952-.4-4.09-.823-8.108-2.136-11.991-3.627,2.894-3.071,6.545-5.435,10.678-6.452.461-.113,1.638-.423,2.044-.4.299.017,1.434,1.163,1.765,1.433,2.19,1.788,4.528,3.349,7.064,4.609.141.07.911.431.957.454Z\"/><path class=\"cls-2\" d=\"M84.869,83.682c.032.148-.043.166-.139.238-.378.284-1.261.601-1.734.869-2.649,1.505-5.069,3.385-7.248,5.506-4.026-.517-7.755-2.163-10.904-4.686-.285-.228-2.106-1.773-2.061-1.969,4.633-1.901,9.447-3.444,14.407-4.247l.203.047c2.125,1.942,4.646,3.59,7.476,4.241Z\"/><path class=\"cls-2\" d=\"M77.647,45.723c5.431-.171,10.781,1.507,14.943,5.001l.76,1.885c-1.021-.185-2.022-.517-3.066-.587-.637-.042-1.378.075-1.995-.021-.705-.11-2.106-.746-2.806-1.057-2.302-1.021-5.941-3.199-7.696-4.985-.072-.074-.131-.175-.141-.236Z\"/><path class=\"cls-2\" d=\"M78.319,90.483c2.219-2.165,5.009-4.09,7.837-5.389.535-.245,1.693-.807,2.218-.889.595-.093,1.303.021,1.915-.017,1.122-.069,2.22-.361,3.313-.591-.198.439-.31,1.136-.523,1.534-.316.59-2.483,2.004-3.146,2.397-3.538,2.094-7.502,2.991-11.615,2.955Z\"/><path class=\"cls-3\" d=\"M74.624,68.901h6.844c.195,0,.112.785.127.965.222,2.691.981,5.362,2.351,7.684-1.096-.156-2.211-.209-3.321-.171-.664.023-1.646.235-2.269.177-.453-.042-.918-.78-1.197-1.154-1.6-2.147-2.494-4.817-2.535-7.501Z\"/><path class=\"cls-3\" d=\"M74.54,67.305c.165-2.465.836-4.867,2.148-6.964.213-.34.911-1.381,1.17-1.601.093-.078.121-.091.246-.091.461,0,1.11.161,1.596.177,1.28.043,2.557-.024,3.825-.171-1.329,2.69-1.988,5.639-2.015,8.649h-6.97Z\"/><path class=\"cls-3\" d=\"M85.35,79.59c.089.076.186.344.316.481.791.833,1.668,1.719,2.73,2.184.048.188-.077.197-.229.228-1.167.231-3.829-.635-4.95-1.138-.448-.201-3.382-1.876-3.385-2.156,0-.091.203-.121.288-.13.856-.094,4.633.021,5.23.532Z\"/><path class=\"cls-3\" d=\"M79.662,57.143c-.01-.18.293-.349.427-.454,2.273-1.79,5.063-2.893,7.971-3.071-.83.62-1.599,1.164-2.311,1.93-.192.207-.806,1.087-.939,1.161-.306.171-2.055.392-2.504.435-.855.081-1.803.145-2.645,0Z\"/></svg>";
var CI_BRAND_PRODUCT = "Companion Memory";
var CI_BRAND_TAGLINE = "Your AI remembers, because it's yours.";
/* END GENERATED brand */

/* ---- Defaults ------------------------------------------------------------ */
var DEFAULT_CI_HOST = 'https://ci-server.local';

/* ---- CI-Server endpoints (the gateway strips /api before NestJS sees it) -- */
var MEMORY_RECALL_PATH  = '/api/memory/recall';
var DEVICES_PATH        = '/api/devices';
var POSITION_PATH       = '/api/position';
var POSITION_STATS_PATH = '/api/position/stats';

/* ---- This app's identity when it registers as a Device -------------------- */
var DEVICE_TYPE = 'smartwatch';
var DEVICE_NAME = 'Pebble Watch';
/* Keep in sync with appinfo.json "versionLabel". */
var APP_VERSION = '1.0';

/* ---- memory.recall request limits (mirrors CI-Server's recallSchema) ----- */
var RECALL_QUERY_MAX_LEN = 2000;
var RECALL_MAX_RESULTS   = 5;
var DEFAULT_RECALL_QUERY = 'Summarize what happened recently and anything I should know about right now.';

/* ---- What fits on the watch ---------------------------------------------- */
var MAX_MSG_LEN   = 252;
var MAX_LINE_LEN  = 72;

/* ---- Timeouts (ms) ------------------------------------------------------- */
var CI_TIMEOUT       = 15000;
var DEVICE_TIMEOUT   = 8000;
var POSITION_TIMEOUT = 8000;
var STATUS_RESET_MS  = 6000;

/* ---- Background task cadence (ms) ---------------------------------------- */
var PASSIVE_LOG_INTERVAL   = 15 * 60 * 1000;
var LOCATION_CACHE_MAX_AGE = 60 * 1000;

var passiveLogTimer = null;


/* ==========================================================================
   Configuration helpers
   ========================================================================== */

function trimString(value) {
  return String(value || '').replace(/^\s+|\s+$/g, '');
}

function normalizeBaseURL(url) {
  return trimString(url).replace(/\/+$/, '');
}

function joinURL(base, path) {
  return normalizeBaseURL(base) + path;
}

function getCIHost() {
  return normalizeBaseURL(localStorage.getItem(STORAGE_CI_HOST) || DEFAULT_CI_HOST);
}

function getApiKey() {
  return trimString(localStorage.getItem(STORAGE_API_KEY) || '');
}

function getDeviceId() {
  return trimString(localStorage.getItem(STORAGE_DEVICE_ID) || '') || null;
}

function isLocationSyncOn() {
  return localStorage.getItem(STORAGE_LOCATION_SYNC) === '1';
}

function getFlag(key) {
  return localStorage.getItem(key) === '1';
}

function setFlag(key, on) {
  if (on) {
    localStorage.setItem(key, '1');
  } else {
    localStorage.removeItem(key);
  }
}

function saveSetting(key, value, normalizer) {
  var nextValue = normalizer ? normalizer(value) : trimString(value);
  if (nextValue) {
    localStorage.setItem(key, nextValue);
  } else {
    localStorage.removeItem(key);
  }
}

function escapeHTML(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cacheResult(result) {
  try {
    localStorage.setItem(STORAGE_CACHE_KEY, result);
  } catch (e) {
    console.log('Failed to cache result: ' + e);
  }
}

/**
 * CI-Server's ApiKeyStrategy reads `x-api-key` first and only falls back to
 * `Authorization: Bearer <key>` for clients that cannot set a custom header.
 * This companion can, so it sends the canonical form.
 */
function setAuthHeader(xhr) {
  var key = getApiKey();
  if (key) {
    xhr.setRequestHeader('x-api-key', key);
  }
}


/* ==========================================================================
   One request helper for every CI-Server call
   ========================================================================== */

/**
 * done(kind, status, text) is called exactly once.
 * kind: 'http' (status and text set), 'network', 'timeout' or 'exception'.
 */
function request(method, path, body, timeoutMs, done) {
  var xhr = new XMLHttpRequest();
  var finished = false;

  function finish(kind, status, text) {
    if (finished) {
      return;
    }
    finished = true;
    done(kind, status, text);
  }

  xhr.timeout = timeoutMs;
  xhr.open(method, joinURL(getCIHost(), path), true);
  if (body !== null) {
    xhr.setRequestHeader('Content-Type', 'application/json');
  }
  setAuthHeader(xhr);

  xhr.onload = function() { finish('http', xhr.status, xhr.responseText); };
  xhr.onerror = function() { finish('network', 0, ''); };
  xhr.ontimeout = function() { finish('timeout', 0, ''); };

  try {
    xhr.send(body === null ? undefined : JSON.stringify(body));
  } catch (e) {
    finish('exception', 0, String(e));
  }
}

function isOk(kind, status) {
  return kind === 'http' && status >= 200 && status < 300;
}

/**
 * A fact plus a fix, in the product voice. No dashes in anything a person reads.
 */
function describeFailure(kind, status) {
  if (kind === 'network') {
    return "Can't reach your Memory. Check the URL and your connection.";
  }
  if (kind === 'timeout') {
    return 'Your Memory took too long. Try again.';
  }
  if (kind === 'exception') {
    return "Couldn't send the request. Check the URL in settings.";
  }
  if (status === 401) {
    return 'Key rejected. Paste it again in settings.';
  }
  if (status === 403) {
    return "Key can't do that. Give it the memory scope.";
  }
  if (status >= 500) {
    return 'Your Memory had a problem (HTTP ' + status + '). Try again.';
  }
  return 'Unexpected reply (HTTP ' + status + '). Check the URL in settings.';
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

function sendToWatch(key, text, label) {
  var msg = {};
  msg[key] = truncate(text);
  Pebble.sendAppMessage(
    msg,
    function() { console.log(label + ' sent to watch'); },
    function(e) { console.log('sendAppMessage (' + label + ') failed: ' + JSON.stringify(e)); }
  );
}

function sendResultToWatch(result) { sendToWatch(KEY_RESULT, result, 'result'); }
function sendErrorToWatch(msg)     { sendToWatch(KEY_ERROR, msg, 'error'); }
function sendStatusToWatch(status) { sendToWatch(KEY_STATUS, status, 'status'); }


/* ==========================================================================
   Recall and Ask (POST /api/memory/recall)
   ========================================================================== */

/**
 * The recall `block` is assembled for an LLM prompt, not for a person:
 *
 *   ## Relevant context
 *   <a long guard sentence saying the text below is data, not instructions>
 *   <<<UNTRUSTED_CONTENT
 *   one memory per line, each with a leading markdown character backslash-escaped
 *   UNTRUSTED_CONTENT>>>
 *
 * Sending that to a 252 character screen shows only the heading and the guard.
 * This takes out the memory lines between the markers and makes them readable.
 */
function extractMemoryLines(block) {
  var open = block.indexOf('<<<UNTRUSTED_CONTENT');
  var close = block.lastIndexOf('UNTRUSTED_CONTENT>>>');
  var body = block;

  if (open !== -1 && close > open) {
    body = block.substring(open + '<<<UNTRUSTED_CONTENT'.length, close);
  }

  var raw = body.split('\n');
  var lines = [];
  var i;

  for (i = 0; i < raw.length; i++) {
    var line = raw[i]
      .replace(/­/g, '')
      .replace(/^\\(?=[#>\-*+=|`~_\d])/, '')
      .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
      .replace(/(\d{4}-\d{2}-\d{2})T[0-9:.]+Z?/g, '$1')
      .replace(/[*_`]{1,3}/g, '')
      .replace(/^\s*#+\s*/, '')
      .replace(/\s+/g, ' ');
    line = trimString(line);

    if (line) {
      lines.push(line.length > MAX_LINE_LEN ? line.substring(0, MAX_LINE_LEN - 3) + '...' : line);
    }
  }

  return lines;
}

function formatRecallResult(data) {
  var block = data && data.block ? String(data.block) : '';
  var count = data && typeof data.resultCount === 'number' ? data.resultCount : null;

  if (!block || count === 0) {
    return 'Nothing found. Try a broader question.';
  }

  var lines = extractMemoryLines(block);
  var out = [];
  var used = 0;
  var i;

  for (i = 0; i < lines.length; i++) {
    var entry = '- ' + lines[i];
    var cost = entry.length + (out.length ? 1 : 0);
    if (used + cost > MAX_MSG_LEN - 12) {
      break;
    }
    out.push(entry);
    used += cost;
  }

  if (out.length === 0) {
    return 'Nothing found. Try a broader question.';
  }

  if (lines.length > out.length) {
    out.push('+' + (lines.length - out.length) + ' more');
  }

  return out.join('\n');
}

function recallMemory(query) {
  var trimmedQuery = trimString(query).substring(0, RECALL_QUERY_MAX_LEN);
  if (!trimmedQuery) {
    sendErrorToWatch('Nothing to ask. Pick a question or speak one.');
    return;
  }

  sendStatusToWatch('Searching Memory...');

  request('POST', MEMORY_RECALL_PATH,
          { query: trimmedQuery, maxResults: RECALL_MAX_RESULTS },
          CI_TIMEOUT,
          function(kind, status, text) {
    if (isOk(kind, status)) {
      try {
        var summary = formatRecallResult(JSON.parse(text));
        cacheResult(summary);
        sendResultToWatch(summary);
        touchDevice();
      } catch (e) {
        console.log('Recall parse error: ' + e);
        sendErrorToWatch('Unexpected reply. Check the URL points at your Memory.');
      }
      return;
    }

    console.log('Recall failed: ' + kind + ' ' + status);
    var cached = localStorage.getItem(STORAGE_CACHE_KEY);
    if (kind === 'network' && cached) {
      sendResultToWatch('Offline. Last answer:\n' + cached);
    } else {
      sendErrorToWatch(describeFailure(kind, status));
    }
  });
}

function fetchMemoryEvents() {
  recallMemory(DEFAULT_RECALL_QUERY);
}

function askMemory(question) {
  recallMemory(question);
}


/* ==========================================================================
   Device registration (POST /api/devices) and heartbeat
   ========================================================================== */

/**
 * Registers this watch as a `smartwatch` Device and caches the server-assigned
 * id. Best effort, and only for a key that is allowed to: on 401 or 403 it sets
 * a flag so it stops asking until the key or URL changes.
 */
function registerDeviceIfNeeded() {
  if (getDeviceId() || !getApiKey() || getFlag(STORAGE_DEVICE_BLOCKED)) {
    return;
  }

  request('POST', DEVICES_PATH,
          { device_type: DEVICE_TYPE, device_name: DEVICE_NAME, app_version: APP_VERSION },
          DEVICE_TIMEOUT,
          function(kind, status, text) {
    if (isOk(kind, status)) {
      try {
        var device = JSON.parse(text);
        if (device && device.device_id) {
          localStorage.setItem(STORAGE_DEVICE_ID, device.device_id);
          console.log('Registered as CI-Server device ' + device.device_id);
        }
      } catch (e) {
        console.log('Device registration parse error: ' + e);
      }
    } else if (kind === 'http' && (status === 401 || status === 403)) {
      setFlag(STORAGE_DEVICE_BLOCKED, true);
      console.log('Device registration needs an unrestricted key; skipping.');
    } else {
      console.log('Device registration failed: ' + kind + ' ' + status);
    }
  });
}

function touchDevice() {
  var deviceId = getDeviceId();
  if (!deviceId || !getApiKey()) {
    return;
  }

  request('PATCH', DEVICES_PATH + '/' + encodeURIComponent(deviceId) + '/last-seen', null,
          DEVICE_TIMEOUT, function(kind, status) {
    if (!isOk(kind, status)) {
      console.log('Device heartbeat failed: ' + kind + ' ' + status);
    }
  });
}


/* ==========================================================================
   Optional location sync (POST /api/position), off unless the user turns it on
   ========================================================================== */

/**
 * One CreatePositionDto. `location.x` is longitude and `.y` latitude: CI-Server
 * stores them as a PostGIS point (ST_X is longitude, ST_Y is latitude).
 */
function buildPositionEntry(position) {
  var entry = { time: new Date().toISOString() };
  var deviceId = getDeviceId();

  if (deviceId) {
    entry.device_id = deviceId;
  }

  if (position && position.coords) {
    entry.location = { x: position.coords.longitude, y: position.coords.latitude };
    if (typeof position.coords.accuracy === 'number') {
      /* accuracy_meters must be strictly positive. */
      entry.accuracy_meters = Math.max(position.coords.accuracy, 0.01);
    }
  }

  return entry;
}

function postPosition(entry) {
  request('POST', POSITION_PATH, [entry], POSITION_TIMEOUT, function(kind, status) {
    if (isOk(kind, status)) {
      touchDevice();
    } else if (kind === 'http' && (status === 401 || status === 403)) {
      setFlag(STORAGE_POSITION_BLOCKED, true);
      console.log('Location upload needs an unrestricted key; stopping.');
    } else {
      console.log('Location upload failed: ' + kind + ' ' + status);
    }
  });
}

function sendPassiveLog() {
  if (!isLocationSyncOn() || !getApiKey() || getFlag(STORAGE_POSITION_BLOCKED)) {
    return;
  }

  var nav = typeof navigator !== 'undefined' ? navigator : null;
  var geolocation = nav && nav.geolocation;

  if (!geolocation || !geolocation.getCurrentPosition) {
    console.log('Geolocation unavailable; skipping location sync');
    return;
  }

  geolocation.getCurrentPosition(
    function(position) { postPosition(buildPositionEntry(position)); },
    function(error) {
      console.log('Geolocation unavailable: ' + (error && error.message ? error.message : error));
    },
    { enableHighAccuracy: false, maximumAge: LOCATION_CACHE_MAX_AGE, timeout: 5000 }
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
   Connection check (after Save, and shown on the settings page)
   ========================================================================== */

/**
 * Asks the three questions a person actually has: do Recall and Ask work, is
 * this watch registered, does location sync work. Stored as JSON so the
 * settings page can show it next time it opens.
 */
function runConnectionCheck(done) {
  var result = { at: new Date().toISOString(), memory: 'unset', device: 'skipped', location: 'off' };

  function finish() {
    try {
      localStorage.setItem(STORAGE_LAST_CHECK, JSON.stringify(result));
    } catch (e) {
      console.log('Failed to store check: ' + e);
    }
    if (done) {
      done(result);
    }
  }

  function checkLocation() {
    if (!isLocationSyncOn()) {
      finish();
      return;
    }
    request('GET', POSITION_STATS_PATH, null, DEVICE_TIMEOUT, function(kind, status) {
      result.location = isOk(kind, status) ? 'ok' : (status === 401 || status === 403 ? 'blocked' : 'error');
      finish();
    });
  }

  function checkDevice() {
    request('GET', DEVICES_PATH, null, DEVICE_TIMEOUT, function(kind, status) {
      result.device = isOk(kind, status) ? 'ok' : (status === 401 || status === 403 ? 'blocked' : 'error');
      if (result.device === 'ok') {
        registerDeviceIfNeeded();
      }
      checkLocation();
    });
  }

  if (!getApiKey()) {
    finish();
    return;
  }

  request('POST', MEMORY_RECALL_PATH, { query: 'connection check', maxResults: 1 }, CI_TIMEOUT,
          function(kind, status) {
    if (isOk(kind, status)) {
      result.memory = 'ok';
      checkDevice();
      return;
    }
    if (kind === 'http' && status === 401) {
      result.memory = 'rejected';
    } else if (kind === 'http' && status === 403) {
      result.memory = 'scope';
    } else if (kind === 'http') {
      result.memory = 'error';
    } else {
      result.memory = 'unreachable';
    }
    finish();
  });
}

function checkHeadline(check) {
  if (check.memory === 'ok') { return 'Connected'; }
  if (check.memory === 'rejected') { return 'Key rejected'; }
  if (check.memory === 'scope') { return 'Key needs memory scope'; }
  if (check.memory === 'unreachable') { return "Can't reach Memory"; }
  if (check.memory === 'unset') { return 'Add your URL and key'; }
  return 'Memory replied with an error';
}

function describeCheck(check) {
  var rows = [];
  var memory = {
    ok: ['ok', 'Recall and Ask work.'],
    rejected: ['bad', 'Key rejected. Paste it again.'],
    scope: ['bad', 'The key is missing the memory scope.'],
    unreachable: ['bad', "Can't reach your Memory. Check the URL."],
    error: ['bad', 'Your Memory replied with an error.'],
    unset: ['warn', 'Add your URL and key, then save.']
  }[check.memory] || ['warn', 'Not checked yet.'];
  var device = {
    ok: ['ok', 'This watch is registered.'],
    blocked: ['warn', 'Registration needs an unrestricted key, so it is skipped.'],
    error: ['warn', 'Registration failed. It will retry later.'],
    skipped: ['warn', 'Registration was not checked.']
  }[check.device] || ['warn', 'Registration was not checked.'];
  var location = {
    off: ['warn', 'Location sync is off.'],
    ok: ['ok', 'Location sync works.'],
    blocked: ['warn', 'Location sync needs an unrestricted key.'],
    error: ['warn', 'Location check failed. Try again later.']
  }[check.location] || ['warn', 'Location sync is off.'];

  rows.push(memory, device, location);
  return rows;
}


/* ==========================================================================
   Settings page (local data: page, so your key never touches a web server)
   ========================================================================== */

function buildConfigurationPage() {
  var check = null;
  try {
    check = JSON.parse(localStorage.getItem(STORAGE_LAST_CHECK) || 'null');
  } catch (e) {
    check = null;
  }

  var checkHtml = '';
  if (check) {
    var rows = describeCheck(check);
    var marks = { ok: 'Ready', warn: 'Note', bad: 'Fix' };
    var i;
    checkHtml = '<div class="card"><h2>Last check</h2>';
    for (i = 0; i < rows.length; i++) {
      checkHtml += '<p class="' + rows[i][0] + '"><b>' + marks[rows[i][0]] + '</b> ' + escapeHTML(rows[i][1]) + '</p>';
    }
    checkHtml += '</div>';
  }

  var css =
    ':root{' + CI_BRAND_LIGHT_CSS + '}' +
    '@media (prefers-color-scheme:dark){:root{' + CI_BRAND_DARK_CSS + '}}' +
    '*{box-sizing:border-box}' +
    'body{margin:0;padding:20px 16px 32px;background:var(--background);color:var(--foreground);' +
      'font:16px/1.45 "Manrope",system-ui,sans-serif}' +
    '.brand{display:flex;align-items:center;gap:12px;margin-bottom:20px}' +
    '.brand svg{width:40px;height:40px;flex:none}' +
    'h1{font-size:18px;margin:0}.tag{margin:2px 0 0;font-size:13px;color:var(--muted-foreground)}' +
    'h2{font-size:15px;margin:0 0 6px}' +
    '.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:16px}' +
    'label{display:block;font-weight:600;font-size:14px;margin:12px 0 4px}' +
    'label:first-of-type{margin-top:0}' +
    'input[type=url],input[type=password]{width:100%;padding:12px;border:1px solid var(--border);' +
      'border-radius:10px;background:var(--background);color:var(--foreground);font:inherit}' +
    '.hint{font-size:13px;color:var(--muted-foreground);margin:4px 0 0}' +
    '.row{display:flex;gap:10px;align-items:flex-start;margin-top:14px}' +
    '.row input{margin-top:5px;width:18px;height:18px;accent-color:var(--primary)}' +
    '.row label{margin:0}' +
    'p{margin:6px 0;font-size:14px}.ok b{color:var(--success)}.warn b{color:var(--warning)}.bad b{color:var(--destructive)}' +
    'button{width:100%;padding:14px;border:0;border-radius:10px;background:var(--primary);' +
      'color:var(--primary-foreground);font:inherit;font-weight:700;cursor:pointer}';

  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHTML(CI_BRAND_PRODUCT) + ' settings</title><style>' + css + '</style></head><body>' +
    '<div class="brand">' + CI_BRAND_MARK_SVG +
      '<div><h1>' + escapeHTML(CI_BRAND_PRODUCT) + '</h1><p class="tag">' + escapeHTML(CI_BRAND_TAGLINE) + '</p></div></div>' +
    '<div class="card"><h2>Connect your Memory</h2>' +
      '<label for="ci_host">Memory URL</label>' +
      '<input id="ci_host" type="url" value="' + escapeHTML(getCIHost()) + '">' +
      '<label for="ci_api_key">API key</label>' +
      '<input id="ci_api_key" type="password" autocomplete="off" value="' + escapeHTML(getApiKey()) + '">' +
      '<p class="hint">Create it in Companion Memory under Settings, API keys. Give it the memory scope.</p>' +
      '<div class="row"><input id="location_sync" type="checkbox"' + (isLocationSyncOn() ? ' checked' : '') + '>' +
      '<div><label for="location_sync">Send my location every 15 minutes</label>' +
      '<p class="hint">Off by default. Needs an unrestricted key. Your location goes to your Memory and nowhere else.</p></div></div>' +
    '</div>' + checkHtml +
    '<button id="save">Save</button>' +
    '<script>(function(){' +
    'function v(id){return document.getElementById(id).value;}' +
    'document.getElementById("save").addEventListener("click",function(){' +
    'var p={ci_host:v("ci_host"),ci_api_key:v("ci_api_key"),location_sync:document.getElementById("location_sync").checked};' +
    'document.location="pebblejs://close#"+encodeURIComponent(JSON.stringify(p));});' +
    '}());<\/script></body></html>';
}


/* ==========================================================================
   Pebble event listeners
   ========================================================================== */

Pebble.addEventListener('ready', function() {
  console.log('PebbleKit JS ready');

  if (!localStorage.getItem(STORAGE_CI_HOST)) {
    console.log('No Memory URL configured; using default: ' + DEFAULT_CI_HOST);
  }
  if (!getApiKey()) {
    console.log('No API key configured yet; open settings to add one.');
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
    var identityChanged =
      normalizeBaseURL(settings.ci_host) !== getCIHost() ||
      trimString(settings.ci_api_key) !== getApiKey();

    saveSetting(STORAGE_CI_HOST, settings.ci_host, normalizeBaseURL);
    saveSetting(STORAGE_API_KEY, settings.ci_api_key, trimString);
    setFlag(STORAGE_LOCATION_SYNC, settings.location_sync === true);

    if (identityChanged) {
      /* An id, a block or a check from another server or key means nothing here. */
      localStorage.removeItem(STORAGE_DEVICE_ID);
      localStorage.removeItem(STORAGE_LAST_CHECK);
      setFlag(STORAGE_DEVICE_BLOCKED, false);
      setFlag(STORAGE_POSITION_BLOCKED, false);
    }

    runConnectionCheck(function(check) {
      sendStatusToWatch(checkHeadline(check));
      setTimeout(function() { sendStatusToWatch(CI_BRAND_PRODUCT); }, STATUS_RESET_MS);
      restartBackgroundTasks();
    });
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
      sendErrorToWatch('Unknown command from the watch. Update both apps.');
      break;
  }
});
