# 04 — API Reference

All routes are registered in `amatic-app/server.js`. Base URL `http://localhost:3001`,
reachable from the frontend as `/api/*` via the Vite proxy.

## Middleware order

```js
cors({ origin: [...], exposedHeaders: ["x-turn-id"] })
correlation                        // x-turn-id in → req.turnId, req.log; echoed out
rateLimit                          // 100 req / 60s per IP, in-memory Map
bodyParser.json({ limit: "50mb" }) // 50mb — canvas images are base64
bodyParser.urlencoded({ extended: true, limit: "50mb" })
```

⚠️ The rate limiter runs **before** body parsing and keys on `req.ip` with no
`app.set("trust proxy")`. Behind a reverse proxy every user shares one bucket. See
[15](15-security-and-deployment.md).

### Correlation: `x-turn-id`

Every request may carry `x-turn-id` (8–64 chars of `[A-Za-z0-9_-]`; anything else is
replaced with a fresh UUID). The client generates one id per teaching turn in
`startTeaching()` and sends it on the master, worker, TTS and telemetry calls of that
turn; background recognition uses its own id, which the brief forwards as
`teachingBrief.recognitionId`. The backend echoes the id in the response header and binds
it to every log line as `turnId` (with the request `path`), so `grep <turnId>` returns
the whole turn.

### Logging

Structured JSON on stdout via pino (`api/lib/logger.js`). `LOG_LEVEL` sets the level,
`LOG_PRETTY=1` renders human-readable output in a terminal. Student content —
`canvasImage`, `voiceTranscript`, `message`, `memoryContext`, TTS `text`, worker
`prompt` — is redacted by path; route code must not log `req.body` wholesale.

Events worth querying: `http_request` (every request, with latency and status),
`llm_call` (every Claude call: tokens, `cache_read_input_tokens`, `cost_usd`,
latency), `image_call`, `tts_call`, `recognize_complete` / `recognize_failed`,
`parser_reject`, `stream_stalled`, `client_disconnect`, `turn_complete`.

---

## Health and metrics

No auth. **These paths are not under `/api/`**, so they are not proxied by Vite — hit
`:3001` directly.

### `GET /healthz` — liveness

Process is up. No dependencies, always 200: `{ "status": "ok", "uptime_s": 42 }`.

### `GET /readyz` — readiness

Can the backend actually reach the providers with the keys it has? One cheap call per
configured provider (Anthropic `models.list`, Gemini `models.list`, ElevenLabs
`user.get`), 5 s budget each, run concurrently, **cached for 30 s**. 200 when every
configured provider answers, 503 otherwise:

```json
{
  "ready": false,
  "providers": {
    "claude":     { "configured": true,  "ok": false, "reason": "HTTP 401", "latency_ms": 310 },
    "gemini":     { "configured": false, "ok": false, "reason": "no key" },
    "elevenlabs": { "configured": true,  "ok": true,  "latency_ms": 180 }
  },
  "checked_at": "2026-09-07T…",
  "cached": false
}
```

### `GET /health` — legacy

The cheap "is it up, are the keys set" call the other docs point at. Unchanged contract:
instant, always 200, `models.*` is key **presence** only (`true` means "a string is set",
not "this key works"). It now also carries `readiness` — the last `/readyz` result if one
has run, otherwise `null` — so provider reachability is visible without a live probe. For
"does the key actually work", call `/readyz`.

Health and metrics routes are mounted **before** the rate limiter, so probes and scrapers
never share the per-IP bucket with student traffic.

### `GET /metrics` — Prometheus

`prom-client` text format. Series (all prefixed `amatic_`):

| Metric | Type | Labels | Answers |
|---|---|---|---|
| `http_requests_total` | counter | route, status (`aborted` = client left mid-response) | traffic and error rate per route; unmatched paths are labelled `unmatched` |
| `http_latency_ms` | histogram | route | what the student waits for |
| `turns_total` | counter | outcome=done\|error\|aborted | throughput and success rate |
| `llm_calls_total` | counter | route, provider, outcome=ok\|error\|aborted | provider reliability; `aborted` is a student interrupt, not a provider fault |
| `llm_latency_ms` | histogram | route, provider | p50/p95/p99 per provider |
| `llm_tokens_total` | counter | model, kind=input\|output\|cache_read\|cache_write | spend attribution; `cache_read` verifies Phase 3.1 |
| `llm_cost_usd_total` | counter | provider | the bill, live (Claude only — see [06](06-costs.md)) |
| `recognize_confidence_total` | counter | level=high\|medium\|low\|failed | **is recognition working?** |
| `parser_rejects_total` | counter | — | is the JSON stream reliable? |
| `worker_dropped_total` | counter | reason=full\|circuit\|closed | are we losing images? |
| `images_generated_total` | counter | outcome=ok\|empty\|error | image provider yield |
| `tts_characters_total` | counter | — | ElevenLabs usage |

Plus Node process defaults (`amatic_process_*`, `amatic_nodejs_*`).

---

## `POST /api/telemetry/turn`

Client → server report at the end of a teaching turn (the browser is the only party that
knows when a turn ended and how). Logged as `turn_complete` under the turn's id and
counted into `amatic_turns_total{outcome}` and `amatic_worker_dropped_total{reason}`.
Unknown outcome or reason values are discarded, never turned into labels. Returns 204.

```json
{
  "outcome": "done",
  "durationMs": 8421,
  "fastPath": true,
  "recognitionId": "…",
  "voiceSentences": 6,
  "canvasTexts": 3,
  "imagesRequested": 5,
  "workers": { "completed": 5, "failed": 0, "dropped": 0, "droppedByReason": {} },
  "error": null
}
```

Per-turn cost is **not** summed here: each `llm_call` event already carries `cost_usd`
and the same `turnId`, so a log query aggregates it.

---

## `POST /api/ai/recognize`

Vision → structured teaching brief. Called in the background while drawing.

**Request**
```json
{ "canvasImage": "<base64 JPEG, no data: prefix>" }
```

**Response 200** — `TeachingBrief` (see [03](03-ai-teaching-loop.md))

**Errors**

| Code | Body | Cause |
|---|---|---|
| 400 | `{"error":"canvasImage (base64) is required"}` | field missing |
| 500 | `{"error":"..."}` | key missing or provider error |

**Model config:** `claude-sonnet-5`, `max_tokens: 8000`, `effort: low`, adaptive thinking.
`max_tokens` was raised from 2000 during the Sonnet 5 migration because thinking now
shares that budget — see [16](16-decisions.md) ADR-002.

---

## `POST /api/ai/master`

The teaching brain. **Responds with SSE, always HTTP 200** — including on error.

**Request**
```json
{
  "message": "string, required, max 10000 chars",
  "canvasContext": { },
  "userIntent": "string",
  "pointedElement": "string",
  "voiceTranscript": "string",
  "memoryContext": "string",
  "canvasImage": "<base64 JPEG>",
  "teachingBrief": { "topic": "", "confidence": "", "visualsAlreadyDispatched": false,
                     "canvasLabels": [], "voiceIntro": "" }
}
```

**Response** — `text/event-stream`, one JSON object per `data:` line:

```
data: {"type":"voice","text":"Let's look at what you drew."}
data: {"type":"visual_prompt","prompt":"…","style":"schematic","location":null}
data: {"type":"canvas_text","content":"F = ma","x":100,"y":100,"fontSize":24}
data: {"type":"next_topic","suggestion":"Momentum","prompt":""}
data: {"type":"done"}
```

**Error shape** — note this arrives as a 200 with an error *event*:

```
data: {"type":"error","message":"API Key missing"}
```

Validation errors delivered this way: `"Valid message required"`,
`"Message too long (max 10,000 characters)"`, `"API Key missing"`.

⚠️ **Design flaw:** because errors are 200 + SSE event, no HTTP-level monitoring, load
balancer, or `res.ok` check can detect a failure. Use `amatic_llm_calls_total{outcome="error"}`
and the `llm_call` log events instead. The client handles `type: "error"` since Phase 1:
the status dot turns red and shows the message, so a keyless backend is no longer silent.

**Model config:** `claude-sonnet-5`, `max_tokens: 64000`, `effort: medium`, adaptive
thinking, `stream: true`. No `temperature` — Sonnet 5 rejects it with a 400.

**Client disconnect** is handled via `res.on("close")` (not `req` — on Node ≥ 16 the
request's `close` fires as soon as body-parser has consumed the body, so the old handler
never ran). It aborts the upstream request, so a closed tab stops burning tokens. A stream
with no delta for 60 s is aborted and reported as `{"type":"error"}`, never as `done`.

---

## `POST /api/ai/worker/:id` and `POST /api/ai/worker`

Image generation. `:id` is accepted and echoed but does not route anything.

**Request**
```json
{ "prompt": "string, max 5000 chars", "style": "3d" | "schematic" | any, "workerId": 1 }
```

**Response 200**
```json
{ "workerId": 1, "status": "success", "imageUrl": "data:image/png;base64,…",
  "imageData": "<base64>", "imageMimeType": "image/png",
  "textDescription": "…", "generationTime": 4213 }
```

**Errors:** 400 prompt too long · 500 `"Gemini API key not configured"` ·
500 `"Gemini did not return image data"`

**Model:** `gemini-2.5-flash-image`, `responseModalities: ["TEXT","IMAGE"]`. The prompt is
wrapped in a hard-coded "hyper-realistic educational image" template — a fixed style
decision worth revisiting for diagrams, where schematic clarity beats photorealism.

---

## `POST /api/ai/visual/orchestrate`

SSE image orchestration. **Not on the Jarvis path** — it was called by the
`handleVisualExplanation` helper that the sidebar removal orphaned. Currently unreachable
from the UI.

---

## Voice endpoints

### `POST /api/voice/text-to-speech`

**Request** `{ "text": "max 5000 chars", "voiceId": "…", "lang": "en-US" }`

**Response 200** — raw audio bytes. The client wraps them in a Blob URL.

**Model:** ElevenLabs `eleven_multilingual_v2`, default voice `EXAVITQu4vr4xnSDxMaL`
("Bella"), `stability: 0.45`, `similarity_boost: 0.75`, `style: 0.35`,
`use_speaker_boost: true`.

### `POST /api/voice/whisper-tts`

Alternate TTS path. Also ElevenLabs. Not called by the Jarvis loop.

### `POST /api/voice/speech-to-text`

⚠️ **A stub.** Always returns `{"transcript": "", "message": "Use Web Speech API in
browser for real-time transcription"}`. Nothing calls it. Either implement it or delete
the route — a 200 with an empty transcript is worse than a 501.

### `POST /api/ai/chat` and `POST /api/voice/chat-simple`

Plain non-streaming chat. **No UI mounts either of these** since the chat sidebar was
removed ([10](10-frontend-ui.md)).

`chat.js` accepts `message` (not `prompt`), optional history. Both return:

```json
{ "response": "…", "model": "claude-sonnet-5", "provider": "anthropic", "timestamp": "…" }
```

`model` is read from `response.model` — the model the API actually served — falling back to
the constant. This was a fix: both endpoints previously reported a model they weren't
calling. See [16](16-decisions.md) ADR-001.

---

## What a production API layer would add

Done in [18](18-implementation-plan.md) Phases 1–2: correlation ids, structured logs,
`/metrics`, `/healthz` + `/readyz`, timeouts and bounded retries on every provider call.

Still missing:

- **Consistent error envelope.** Right now: JSON 400/500 on some routes, SSE-200-with-error
  on `master`, and a stub returning success.
- **Versioning.** No `/api/v1` prefix, so any breaking change breaks all clients.
- **Idempotency keys** — a retried worker call regenerates (and re-bills) an image.
- **Auth** on every `/api/*` route — see [15](15-security-and-deployment.md).

All of that is scoped in [18-implementation-plan.md](18-implementation-plan.md).
