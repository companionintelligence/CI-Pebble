# Companion Pebble

Companion Pebble smartwatch app that acts as a wearable interface for the
[Companion Intelligence (CI) Digital Memory server](https://github.com/companionintelligence/CI-Server)
(CI-Server).

> **Looking for the connection audit?** See
> [`docs/CI-Integration-Audit.md`](docs/CI-Integration-Audit.md) for a
> ground-truth comparison of what this app calls against CI-Server's real
> API, and what changed.

---

## Architecture

```
Pebble Watch  <->  Phone Companion (PebbleKit JS)  <->  CI-Server
    (C)                  (JavaScript)                     (REST)
```

All heavy processing happens off the watch. The watch UI sends small
AppMessage packets over Bluetooth to the phone companion, which makes a
single authenticated HTTPS call to CI-Server, then relays the result back
to the watch.

**CI-Server is the only service this app talks to.** Two things it
deliberately never does, both covered in the audit doc:

- **It never calls Ollama directly.** Ollama is CI-Server's own internal LLM
  backend (or an OpenAI-compatible endpoint CI-Server is configured to use
  instead) — CI-Server owns model selection, tool-calling, and conversation
  state. A watch companion has no business holding a second, unauthenticated
  connection straight into that backend.
- **It never calls CI-Hub.** CI-Hub is the appliance's local app runtime for
  installed marketplace apps; CI-Server-to-Hub traffic is internal,
  signed service-to-service messaging (used e.g. to wake an installed
  agent app), not a surface external device clients are meant to reach.

### Data-flow sequence

```
Watch          Phone                    CI-Server
  |              |                          |
  |--CMD_FETCH-->|                          |
  |              |--POST /api/memory/recall>|
  |              |<------{block, count}-----|
  |<--KEY_RESULT-|                          |
  |              |                          |
  |--CMD_ASK_AGENT>                         |
  |              |--POST /api/memory/recall>|
  |              |<------{block, count}-----|
  |<--KEY_RESULT-|                          |
```

`Recall Memory` and `Ask AI` are the same CI-Server call
(`POST /api/memory/recall`) with a different `query` string: a fixed
"what's going on" prompt for Recall Memory, the user's typed/dictated
question for Ask AI. Both return a markdown block of **retrieved** memory
content — a semantic search result, not a generated conversational
answer. See the audit doc for why.

---

## Project structure

```
CI-Pebble/
├── appinfo.json          # Pebble app metadata, AppMessage key definitions
├── wscript               # Pebble SDK (WAF) build script
├── src/
│   ├── c/
│   │   └── main.c        # Watch C app – UI, AppMessage, persistent storage
│   └── js/
│       └── pebble-js-app.js  # Phone companion – CI-Server calls
├── site/                 # Static Cloudflare Pages site for pebble.ci.computer
├── docs/
│   └── CI-Integration-Audit.md
└── README.md
```

---

## Features

| Feature | Description |
|---|---|
| **Recall Memory** | Calls `POST /api/memory/recall` with a fixed prompt and shows the returned memory summary on the watch |
| **Ask AI** | Presents predefined questions and, on microphone-equipped watches, a Pebble Dictation option for ad-hoc questions — each one is sent to `POST /api/memory/recall` as the `query` |
| **Last Result** | Shows the last response cached in Pebble persistent storage (works offline) |
| **Configuration page** | Lets you set the CI-Server URL and API key from the Pebble phone app |
| **Passive sync** | Every 15 minutes, uploads a phone geolocation sample to `POST /api/position` when location permission is available. No step-count/health telemetry is sent — CI-Server has no live ingestion endpoint for it (bulk Apple Health / Google Fit import is a separate, unrelated CI-Server feature) |
| **Device registration** | Registers itself once as a CI-Server `smartwatch` device (`POST /api/devices`) and heartbeats it (`PATCH /api/devices/:id/last-seen`) so it shows up in the user's device list |
| **Status bar** | Shows transient status ("Loading…", "Thinking…", "Send failed") at the bottom of the main window |
| **Error handling** | Network errors, JSON parse failures, and AppMessage drops are all caught and reported gracefully |

**Not currently offered:** server-pushed notifications. CI-Server's
notification mechanism is Web Push (VAPID), which isn't something a
PebbleKit JS companion can subscribe to, and there is no pollable REST
feed to fall back to. See the audit doc's Open Gaps section before
re-adding this to the feature list.

---

## Requirements

| Component | Details |
|---|---|
| Pebble SDK | 3.x (any platform: Aplite, Basalt, Chalk, Diorite, Emery) |
| CI-Server | A running appliance exposing `POST /api/memory/recall`, `POST /api/devices`, and `POST /api/position` (all present on any current CI-Server build) |
| CI-Server API key | Created on CI-Server under Settings → API Keys with the **`memory`** scope enabled |
| Phone | Android (recommended) or iOS with HTTPS access to CI-Server |

Ollama and CI-Hub are **not** requirements from this app's point of view —
they're CI-Server's own concern (CI-Server talks to Ollama internally; it
has no dependency on CI-Hub at all for anything this app uses).

---

## Setup

### 1 – Install Pebble SDK

```bash
# Install the Pebble SDK and confirm the CLI works
pebble sdk install latest
pebble --version
```

### 2 – Get a CI-Server API key

Start (or use your existing) CI-Server appliance, then create an API key
with the `memory` scope from its Settings → API Keys screen. Verify the
appliance is reachable and the key works:

```bash
curl -X POST https://ci-server.local/api/memory/recall \
  -H "x-api-key: <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"query": "what happened recently?", "maxResults": 3}'
```

A `{"block": "...", "resultCount": N}` response means you're set.

### 3 – Configure the phone companion

By default the companion uses:

| Setting | Default |
|---|---|
| CI-Server base URL | `https://ci-server.local` |

Open the Pebble phone app, tap the gear next to **CI Memory**, and save:

| Setting | Purpose |
|---|---|
| CI-Server URL | Base URL for memory recall, device registration, and position uploads |
| API key | Sent as `x-api-key` on every request; must carry the `memory` scope |

The same values can still be overridden from the Pebble app JavaScript console:

```js
localStorage.setItem('ci_host',   'https://192.168.1.100:8443');
localStorage.setItem('ci_api_key', '<your-api-key>');
```

### 4 – Build and install

```bash
pebble build
# Install on emulator for quick testing
pebble install --emulator basalt --logs

# Install on a real device (watch must be paired via Bluetooth)
pebble install --phone <PHONE_IP> --logs
```

---

## AppMessage keys

Defined in `appinfo.json` → `"appKeys"` and mirrored in both `main.c` and
`pebble-js-app.js`:

| Key | Value | Direction | Description |
|---|---|---|---|
| `KEY_COMMAND` | 0 | Watch → Phone | Numeric command code |
| `KEY_QUERY` | 1 | Watch → Phone | Optional text payload (question) |
| `KEY_RESULT` | 2 | Phone → Watch | Result string (max 252 chars) |
| `KEY_ERROR` | 3 | Phone → Watch | Error description |
| `KEY_STATUS` | 4 | Phone → Watch | Transient status text |

Command codes sent via `KEY_COMMAND`:

| Code | Name | Payload |
|---|---|---|
| 1 | `CMD_FETCH_EVENTS` | none |
| 2 | `CMD_ASK_AGENT` | Question string in `KEY_QUERY` |

---

## Security & Privacy

* All data stays on your own hardware (CI-Server is self-hosted).
* Use **HTTPS** for phone → CI-Server calls (required on iOS).
* The API key is stored in phone `localStorage`, sent only as the
  `x-api-key` header on requests to the CI-Server URL you configured —
  never anywhere else.
* Passive location samples are obtained from the paired phone only when the
  Pebble companion is active and are uploaded to your own CI-Server.
* This app never talks to Ollama or CI-Hub directly — see Architecture above.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| AppMessage NACK / outbox full | Only one message can be in-flight at a time. Wait for the previous send to complete before sending another. |
| Watch shows nothing after selecting a menu item | Check phone logs (`pebble logs`) for XHR errors. Confirm CI-Server URL and API key are correct. |
| "Parse error" on watch | Log `xhr.responseText` on the phone. The server may be returning HTML (error page) instead of JSON — usually a wrong CI-Server URL. |
| "Check API key/scope" on watch | The API key is missing, wrong, or lacks the `memory` scope. Recreate it on CI-Server under Settings → API Keys. |
| "Nothing relevant found in memory." | CI-Server's recall returned zero results for that query — not an error. Try a broader question. |
| iOS network calls fail | Ensure the CI-Server URL uses HTTPS. iOS only allows HTTPS or whitelisted domains. |
| Dictation is missing from the Ask AI menu | Pebble Dictation requires a microphone-equipped watch (Basalt/Chalk/Diorite/Emery). Aplite continues to show predefined questions only. |
| Passive location logs never appear on CI-Server | Confirm the phone granted location permission to the Pebble app; denied permission means the upload is skipped rather than sent empty. |
| "No cached result" on watch | The watch cache is populated only after the first successful fetch. Connect the phone and run "Recall Memory" first. |
