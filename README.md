# CI-Pebble

A Pebble smartwatch app that acts as a wearable interface for the
[Companion Intelligence (CI) Digital Memory server](https://github.com/companionintelligence/CI-Server)
and the [Ollama](https://ollama.com) local LLM runtime.

---

## Architecture

```
Pebble Watch  ←→  Phone Companion (PebbleKit JS)  ←→  CI-Server  ←→  Ollama LLM
    (C)                  (JavaScript)                   (REST)         (HTTP API)
```

All heavy processing happens off the watch.  The watch UI sends small
AppMessage packets over Bluetooth to the phone companion, which makes HTTPS
calls to the CI-Server REST API and/or HTTP calls to the Ollama `/api/chat`
endpoint, then relays results back to the watch.

### Data-flow sequence

```
Watch          Phone             CI-Server          Ollama
  |                |                  |                 |
  |--CMD_FETCH---->|                  |                 |
  |                |--GET /api/events>|                 |
  |                |<----JSON events--|                 |
  |<--KEY_RESULT---|                  |                 |
  |                |                  |                 |
  |--CMD_ASK_AGENT>|                  |                 |
  |                |--POST /api/chat------------------>|
  |                |<-----------JSON answer------------|
  |<--KEY_RESULT---|                  |                 |
```

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
│       └── pebble-js-app.js  # Phone companion – CI-Server & Ollama calls
└── README.md
```

---

## Features

| Feature | Description |
|---|---|
| **Recall Memory** | Fetches recent events from CI-Server and shows a summary on the watch |
| **Ask AI** | Presents a list of predefined questions; sends the selected question to Ollama and displays the answer |
| **Last Result** | Shows the last response cached in Pebble persistent storage (works offline) |
| **Status bar** | Shows transient status ("Loading…", "Thinking…", "Send failed") at the bottom of the main window |
| **Error handling** | Network errors, JSON parse failures, and AppMessage drops are all caught and reported gracefully |

---

## Requirements

| Component | Details |
|---|---|
| Pebble SDK | 3.x (any platform: Aplite, Basalt, Chalk, Diorite, Emery) |
| CI-Server | Running locally; exposes `GET /api/events` returning a JSON array |
| Ollama | Running locally on `http://localhost:11434` with `gemma3` model pulled |
| Phone | Android (recommended) or iOS with HTTPS access to CI-Server |

---

## Setup

### 1 – Install Pebble SDK

```bash
# Install the Pebble SDK and confirm the CLI works
pebble sdk install latest
pebble --version
```

### 2 – Configure CI-Server and Ollama

Start your CI-Server and verify:

```bash
curl https://ci-server.local/api/events
```

Start Ollama and pull the model:

```bash
ollama pull gemma3
# Verify:
curl http://localhost:11434/api/version
```

### 3 – Configure the phone companion (optional)

By default the companion uses:

| Setting | Default |
|---|---|
| CI-Server base URL | `https://ci-server.local` |
| Ollama base URL | `http://localhost:11434` |

Override them at runtime by setting `localStorage` values in the phone's
Pebble app JavaScript console, or by adding a configuration page:

```js
localStorage.setItem('ci_host',      'https://192.168.1.100:8443');
localStorage.setItem('ollama_url',   'http://192.168.1.100:11434');
localStorage.setItem('ci_auth_token', '<your-bearer-token>');
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
* Bearer tokens are stored in phone `localStorage` — do **not** store
  unencrypted private keys there.
* Ollama is accessed over plain HTTP on `localhost`; no API key is required
  for a local-only setup.
* The watch app never communicates with any third-party service.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| AppMessage NACK / outbox full | Only one message can be in-flight at a time. Wait for the previous send to complete before sending another. |
| Watch shows nothing after selecting a menu item | Check phone logs (`pebble logs`) for XHR errors. Confirm CI-Server URL and token are correct. |
| "Parse error" on watch | Log `xhr.responseText` on the phone. The server may be returning HTML (error page) instead of JSON. |
| "LLM unavailable" | Ensure Ollama is running: `curl http://localhost:11434/api/version`. |
| "LLM timed out" | The model may be loading for the first time. Retry or increase `OLLAMA_TIMEOUT` in `pebble-js-app.js`. |
| iOS network calls fail | Ensure the CI-Server URL uses HTTPS. iOS only allows HTTPS or whitelisted domains. |
| "No cached result" on watch | The watch cache is populated only after the first successful fetch. Connect the phone and run "Recall Memory" first. |

---

## Implementation roadmap

- [x] Pebble C app – main menu, result window, question selector, AppMessage, persistent storage
- [x] PebbleKit JS – CI-Server XHR, Ollama fetch, localStorage caching, error handling
- [ ] CI-Server authentication (OAuth / JWT login flow via configuration page)
- [ ] Dynamic question input (e.g. Pebble Dictation API on supported hardware)
- [ ] Passive health / location logging to CI-Server
- [ ] Push notifications from CI-Server via phone
