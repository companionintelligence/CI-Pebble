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
var CMD_LOG_PASSIVE  = 3;

/* ---- localStorage keys --------------------------------------------------- */
var STORAGE_CI_HOST    = 'ci_host';
var STORAGE_AUTH_TOKEN = 'ci_auth_token';
var STORAGE_OLLAMA_URL = 'ollama_url';
var STORAGE_CACHE_KEY  = 'last_result';
var STORAGE_NOTIFICATION_CURSOR = 'notification_cursor';

/* ---- Defaults (user can override via localStorage from a config page) ---- */
var DEFAULT_CI_HOST    = 'https://ci-server.local';
var DEFAULT_OLLAMA_URL = 'http://localhost:11434';

/* ---- CI-Server endpoints ------------------------------------------------- */
var PASSIVE_LOG_PATH   = '/api/passive-log';
var NOTIFICATIONS_PATH = '/api/notifications';

/* ---- LLM model to use (matches CI-Server .env OLLAMA_HOST setting) ------- */
var OLLAMA_MODEL = 'gemma3';

/* ---- Request timeout values (ms) ---------------------------------------- */
var CI_TIMEOUT     = 10000;
var OLLAMA_TIMEOUT = 30000;
var PASSIVE_LOG_TIMEOUT = 8000;
var NOTIFICATION_TIMEOUT = 8000;

/* ---- Maximum characters to send in a single AppMessage ------------------- */
var MAX_MSG_LEN = 252;

/* ---- Background task cadence (ms) ---------------------------------------- */
var PASSIVE_LOG_INTERVAL = 15 * 60 * 1000;
var NOTIFICATION_POLL_INTERVAL = 60 * 1000;
var LOCATION_CACHE_MAX_AGE = 60 * 1000;

var passiveLogTimer = null;
var notificationPollTimer = null;


/* ==========================================================================
   Configuration helpers
   ========================================================================== */

function getCIHost() {
  return normalizeBaseURL(localStorage.getItem(STORAGE_CI_HOST) || DEFAULT_CI_HOST);
}

function getOllamaURL() {
  return normalizeBaseURL(localStorage.getItem(STORAGE_OLLAMA_URL) || DEFAULT_OLLAMA_URL);
}

function getAuthToken() {
  return trimString(localStorage.getItem(STORAGE_AUTH_TOKEN) || '');
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

function setAuthHeader(xhr) {
  var token = getAuthToken();
  if (token) {
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
  }
}

function getNotificationCursor() {
  return localStorage.getItem(STORAGE_NOTIFICATION_CURSOR) || '';
}

function setNotificationCursor(cursor) {
  if (cursor) {
    localStorage.setItem(STORAGE_NOTIFICATION_CURSOR, cursor);
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
    '<p>Configure CI-Server authentication, Ollama access, and the background sync endpoints used by the companion app.</p>' +
    '<label for="ci_host">CI-Server URL</label>' +
    '<input id="ci_host" type="url" value="' + escapeHTML(getCIHost()) + '">' +
    '<label for="ci_auth_token">Bearer token</label>' +
    '<input id="ci_auth_token" type="password" autocomplete="off" value="' + escapeHTML(getAuthToken()) + '">' +
    '<label for="ollama_url">Ollama URL</label>' +
    '<input id="ollama_url" type="url" value="' + escapeHTML(getOllamaURL()) + '">' +
    '<button id="save">Save</button>' +
    '<script>(function(){' +
    'function value(id){return document.getElementById(id).value;}' +
    'document.getElementById("save").addEventListener("click", function(){' +
    'var payload={' +
    'ci_host:value("ci_host"),' +
    'ci_auth_token:value("ci_auth_token"),' +
    'ollama_url:value("ollama_url")' +
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

function notifyWatch(title, body) {
  if (Pebble.showSimpleNotificationOnPebble) {
    Pebble.showSimpleNotificationOnPebble(truncate(title), truncate(body || ''));
  } else {
    sendStatusToWatch(title);
  }
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
  var url = joinURL(getCIHost(), '/api/events');
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
  setAuthHeader(xhr);

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
  var url = joinURL(getOllamaURL(), '/api/chat');
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
   Passive health/location logging
   ========================================================================== */

function parseHealthQuery(query) {
  var result = {};
  var parts = String(query || '').split('&');
  var i;

  for (i = 0; i < parts.length; i++) {
    if (!parts[i]) {
      continue;
    }

    var pair = parts[i].split('=');
    var key = pair[0];
    var value = pair.length > 1 ? parseInt(pair[1], 10) : null;

    if (key) {
      result[key] = isNaN(value) ? pair[1] : value;
    }
  }

  return result;
}

function buildPassiveLogPayload(healthQuery, position) {
  var payload = {
    timestamp: new Date().toISOString()
  };
  var key;
  var healthMetrics = parseHealthQuery(healthQuery);

  for (key in healthMetrics) {
    if (healthMetrics.hasOwnProperty(key)) {
      payload[key] = healthMetrics[key];
    }
  }

  if (position && position.coords) {
    payload.latitude = Number(position.coords.latitude.toFixed(6));
    payload.longitude = Number(position.coords.longitude.toFixed(6));
    payload.accuracy_m = Math.round(position.coords.accuracy || 0);
  }

  return payload;
}

function postPassiveLog(payload) {
  var url = joinURL(getCIHost(), PASSIVE_LOG_PATH);
  var xhr = new XMLHttpRequest();

  xhr.timeout = PASSIVE_LOG_TIMEOUT;
  xhr.open('POST', url, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  setAuthHeader(xhr);

  xhr.onload = function() {
    if (xhr.status >= 200 && xhr.status < 300) {
      console.log('Passive log uploaded');
    } else {
      console.log('Passive log failed: ' + xhr.status);
    }
  };

  xhr.onerror = function() {
    console.log('Passive log network error');
  };

  xhr.ontimeout = function() {
    console.log('Passive log timed out');
  };

  try {
    xhr.send(JSON.stringify(payload));
  } catch (e) {
    console.log('Failed to send passive log: ' + e);
  }
}

function sendPassiveLog(healthQuery) {
  var nav = typeof navigator !== 'undefined' ? navigator : null;
  var geolocation = nav && nav.geolocation;

  if (geolocation && geolocation.getCurrentPosition) {
    geolocation.getCurrentPosition(
      function(position) {
        postPassiveLog(buildPassiveLogPayload(healthQuery, position));
      },
      function(error) {
        console.log('Geolocation unavailable: ' + (error && error.message ? error.message : error));
        postPassiveLog(buildPassiveLogPayload(healthQuery, null));
      },
      {
        enableHighAccuracy: false,
        maximumAge: LOCATION_CACHE_MAX_AGE,
        timeout: 5000
      }
    );
  } else {
    postPassiveLog(buildPassiveLogPayload(healthQuery, null));
  }
}

function schedulePassiveLog() {
  if (passiveLogTimer) {
    clearTimeout(passiveLogTimer);
  }

  passiveLogTimer = setTimeout(function() {
    sendPassiveLog('');
    schedulePassiveLog();
  }, PASSIVE_LOG_INTERVAL);
}


/* ==========================================================================
   CI-Server notifications
   ========================================================================== */

function getNotificationTimestamp(notification) {
  return notification.timestamp || notification.created_at || notification.date || '';
}

/**
 * Convert a notification timestamp string into milliseconds since epoch for
 * reliable ordering across ISO-8601 and RFC-style date formats.
 *
 * @param {string} timestamp - Raw timestamp string from the CI-Server.
 * @returns {?number} Milliseconds since epoch, or null when parsing fails.
 */
function getComparableTimestamp(timestamp) {
  var parsed = Date.parse(timestamp);
  return isNaN(parsed) ? null : parsed;
}

function pollNotifications() {
  var url = joinURL(getCIHost(), NOTIFICATIONS_PATH);
  var since = getNotificationCursor();
  var xhr = new XMLHttpRequest();

  if (since) {
    url += '?since=' + encodeURIComponent(since);
  }

  xhr.timeout = NOTIFICATION_TIMEOUT;
  xhr.open('GET', url, true);
  setAuthHeader(xhr);

  xhr.onload = function() {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        var data = JSON.parse(xhr.responseText);
        var notifications = Array.isArray(data) ? data : (data.notifications || []);
        var latestTimestamp = since;
        var latestTimestampValue = getComparableTimestamp(since);
        var i;

        for (i = 0; i < notifications.length; i++) {
          var notification = notifications[i];
          notifyWatch(notification.title || 'CI Update',
                      notification.body || notification.message || '');

          var timestamp = getNotificationTimestamp(notification);
          var timestampValue = getComparableTimestamp(timestamp);
          if (timestampValue !== null &&
              (latestTimestampValue === null || timestampValue > latestTimestampValue)) {
            latestTimestamp = timestamp;
            latestTimestampValue = timestampValue;
          }
        }

        if (!latestTimestamp && notifications.length > 0) {
          latestTimestamp = new Date().toISOString();
        }
        setNotificationCursor(latestTimestamp);
      } catch (e) {
        console.log('Notification parse error: ' + e);
      }
    } else {
      console.log('Notification poll failed: ' + xhr.status);
    }
  };

  xhr.onerror = function() {
    console.log('Notification poll network error');
  };

  xhr.ontimeout = function() {
    console.log('Notification poll timed out');
  };

  try {
    xhr.send();
  } catch (e) {
    console.log('Failed to poll notifications: ' + e);
  }
}

function scheduleNotificationPoll() {
  if (notificationPollTimer) {
    clearTimeout(notificationPollTimer);
  }

  notificationPollTimer = setTimeout(function() {
    pollNotifications();
    scheduleNotificationPoll();
  }, NOTIFICATION_POLL_INTERVAL);
}

function restartBackgroundTasks() {
  sendPassiveLog('');
  schedulePassiveLog();
  scheduleNotificationPoll();
  pollNotifications();
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
    saveSetting(STORAGE_AUTH_TOKEN, settings.ci_auth_token, trimString);
    saveSetting(STORAGE_OLLAMA_URL, settings.ollama_url, normalizeBaseURL);
    if (nextCIHost !== previousCIHost) {
      localStorage.removeItem(STORAGE_NOTIFICATION_CURSOR);
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
      askOllamaAgent(question);
      break;
    }

    case CMD_LOG_PASSIVE:
      sendPassiveLog(payload[KEY_QUERY] || '');
      break;

    default:
      console.log('Unknown command: ' + command);
      sendErrorToWatch('Unknown command');
      break;
  }
});
