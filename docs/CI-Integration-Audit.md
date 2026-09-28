# CI-Pebble connection audit — CI-Server & CI-Hub

**Date:** 2026-09-28
**Verified against:** `companionintelligence/ci-server` @ `e05a0981057b8158521450f9eba1ba4b0fefd0d6`,
`companionintelligence/ci-hub` @ `affad01772bfc99f48564653166ecbabb235fc30`
(both read directly from source, not from documentation or memory).

This repo's CLAUDE.md/AGENTS.md/ANTIGRAVITY.md describe CI-Pebble as the
**Device** layer of the Companion Intelligence platform, talking to
CI-Server and CI-Hub. Before this pass, `pebble-js-app.js` had never been
checked against either repo's actual code — it called endpoints that were
never real, and reached past CI-Server for things CI-Server already owns.
This doc is that check, and a record of what changed.

## 1. Endpoints the old code called that do not exist

| Old call | Where it lived | Reality |
|---|---|---|
| `GET /api/events` | `fetchMemoryEvents()` | No `events` REST controller exists in `backend/apps/api/src/domains/*`. The `events` domain has an entity/pipeline, not a public list endpoint shaped like this. |
| `POST /api/passive-log` | `postPassiveLog()` | No such route anywhere in CI-Server. |
| `GET /api/notifications?since=` | `pollNotifications()` | No such route. CI-Server's real notification mechanism is Web Push (VAPID) via `domains/planning/services/{PushSubscriptionService,WebPushService}.ts` — a push subscription model, not a pollable feed. |
| `POST http://<ollama_url>/api/chat` | `askOllamaAgent()` | Correct as an Ollama API shape, but wrong target: this hit a bare Ollama instance on the phone's LAN directly, bypassing CI-Server entirely. |

None of these were ever reachable against a real CI-Server deployment —
every one of these calls would 404 (or simply refuse to connect, for the
raw Ollama URL) in production. The app worked only against a hand-rolled
mock server that happened to implement this fictional contract.

## 2. What CI-Server actually exposes, and what this app now calls

All three real endpoints below are guarded by `JwtOrApiKeyAuthGuard` /
`ApiKeyGuard` and read credentials via `x-api-key: <key>` (falling back to
`Authorization: Bearer <key>` for clients that can't set a custom header —
see `backend/apps/api/src/domains/auth/services/ApiKeyStrategy.ts:13-41`).
The gateway strips the `/api/` prefix before it reaches NestJS
(`backend/apps/api/src/domains/agent/controllers/IntentsController.ts:38-48`
documents this rewrite), so controller-relative paths below are shown with
`/api` added back on, matching what a client actually calls.

### `POST /api/memory/recall`

`backend/apps/api/src/domains/agent/controllers/MemoryController.ts:124-137`.
Guard: `ApiKeyGuard` + `@RequireScopes(MEMORY_SCOPE)` (`'memory'`,
`common/decorators/RequireScopes.ts:26`) + `@RequireCapability(READ_CAPABILITY)`.
Request body (`recallSchema`, `domains/agent/types.ts:9-12`):

```json
{ "query": "string, 1-2000 chars", "maxResults": "integer 1-20, optional" }
```

Response: `{ "block": "markdown string", "resultCount": number }` — a
hybrid keyword/semantic search over the user's knowledge graph, hydrated
into readable text. **Both** `Recall Memory` and `Ask AI` now call this,
with a fixed prompt for the former and the user's question for the latter.

This is a plain JSON request/response — no streaming — which is exactly
why it's usable from PebbleKit JS's `XMLHttpRequest`. CI-Server's own
generative chat endpoint (`POST /api/llm/generate`,
`domains/llm/controllers/OllamaController.ts:76-147`) is not: it responds
`text/event-stream` framed with a private binary protocol
(`common/rpc/FrameEncoder.ts` — 1-byte channel/flags header + 4-byte
big-endian length + UTF-8 body, repeated per chunk), built for CI-Server's
own web/mobile UI to consume via `fetch`+`ReadableStream`. Decoding that
from an old PebbleKit JS `XMLHttpRequest` (uncertain `responseType:
'arraybuffer'` support, no stream events) would mean depending on an
internal, versionless wire format with no way to verify it actually
works on real Pebble hardware. That's the trade this app makes:
`Ask AI` returns **retrieved memory content**, not a generated
conversational reply. If a real generative Q&A endpoint is wanted for
headless/device clients, that's new scope on CI-Server, not something to
fake from this side.

### `POST /api/devices`, `PATCH /api/devices/:id/last-seen`

`backend/apps/api/src/domains/devices/controllers/DeviceController.ts`.
Guard: `JwtOrApiKeyAuthGuard`, no scope requirement. `device_type` accepts
`'smartwatch'` as a first-class enum value
(`domains/devices/types.ts:9-19`) — this app registers itself as one, once,
and caches the server-assigned `device_id` (`uuid7()`-generated server-side,
`domains/devices/services/DeviceService.ts:35`). All other calls are
best-effort: a failed or skipped registration doesn't block recall or
position uploads, since `device_id` is optional everywhere it's used.

### `POST /api/position`

`backend/apps/api/src/domains/position/controllers/PositionController.ts:40-60`.
Guard: `JwtOrApiKeyAuthGuard`, no scope requirement. Body is an array of
(`createPositionSchemaRoot`, `domains/position/types.ts:26-41`):

```json
{
  "time": "ISO 8601 datetime, required",
  "device_id": "uuid, optional",
  "location": { "x": "longitude", "y": "latitude" },
  "accuracy_meters": "number > 0, optional"
}
```

This app posts a one-entry array per sample and skips the upload entirely
when geolocation isn't available, rather than post a location-less record.

## 3. CI-Hub: why this app still never calls it

CI-Hub is the appliance's **local app runtime** — it installs and
supervises marketplace apps and runs its own MCP server bridging native +
installed-app tools. It is not a data-plane surface. The one place
CI-Server calls Hub is internal, signed service-to-service traffic to wake
an installed agent app
(`backend/apps/api/src/domains/agent/services/HubDoorbellService.ts:107-169`,
HMAC-signed via `CONNECT_SIGNATURE_HEADER`/`CI_HUB_FORWARD_AUTH_SECRET`) —
not something exposed to, or appropriate for, an external device client.
Searching CI-Hub's own tree for any wearable/companion-device integration
turned up nothing but a tutorial-video storyboard mention. CI-Pebble
talking to CI-Server only, and never to CI-Hub, is the correct shape —
this doc exists so that stays a documented decision rather than an
accident nobody checked.

## 4. Auth

The old bearer-token field was not wrong on its own — CI-Server's
`ApiKeyStrategy` does accept `Authorization: Bearer <key>` as a fallback —
but it's not the primary/documented header, and the config UI never told
the user their token needed the right **scope**. This app now sends
`x-api-key` (the header CI-Server's own doc comment calls canonical) and
the setup docs call out that the key needs the `memory` scope, since
`/api/memory/recall` enforces it and a scope-less/wrong-scope key fails
with a 403 that used to just read "Server error: 403".

## 5. Removed: step-count / health telemetry

The watch previously sampled `HealthMetricStepCount` and pushed
`"steps=N"` up through the (fictional) passive-log endpoint. There is no
live step-count ingestion endpoint in CI-Server — health data only enters
via bulk Apple Health / Google Fit *import* (`domains/import/datasources/
{apple_health,google_fit}.ts`), a one-time historical import, not a
streaming device API. Since there was never a real destination for this
data, the health-service code was removed from `main.c` (`PBL_HEALTH`
block) rather than left running against nothing, and the `health`
capability was dropped from `appinfo.json`. Passive sync is now
location-only, driven entirely by the phone's timer (independent of any
watch-side trigger).

## 6. Open gaps (need a CI-Server change, not a CI-Pebble one)

- **No headless notification feed.** CI-Server's push mechanism is Web
  Push, which a PebbleKit JS companion can't subscribe to (no service
  worker context), and there's no pollable REST alternative. Re-adding
  "Server notifications" to this app's feature list needs either a new
  CI-Server endpoint (e.g. `GET /api/notifications?since=`, genuinely
  built this time) or a documented decision that this device class is
  out of scope for push.
- **No live health/step ingestion.** If watch-collected health data should
  reach CI-Server, that needs a real CI-Server endpoint — this repo has no
  write access to add one, and shouldn't invent a client for one that
  doesn't exist.
- **No stable non-streaming chat endpoint.** If a generated (not
  retrieved) conversational answer is wanted on the watch, CI-Server would
  need to expose a plain-JSON completion route, since its existing one is
  an internal streaming protocol for its own UI.

## 7. Deploy target — `pebble.ci.computer`

A static Cloudflare Pages site now lives under `site/` for the public
`pebble.ci.computer` landing/setup page. See `site/README.md` for what it
is, and why the actual Cloudflare account/DNS wiring is outside what this
session could do (no Cloudflare credentials in this environment) — it's
scaffolded and ready to deploy, not deployed.
