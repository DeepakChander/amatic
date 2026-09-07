# 04 — API Reference

All routes are registered in `amatic-app/server.js`. Base URL `http://localhost:3001`,
reachable from the frontend as `/api/*` via the Vite proxy.

## Middleware order

```js
cors({ origin: ["http://localhost:3000", "http://localhost:5000"] })
rateLimit                          // 100 req / 60s per IP, in-memory Map
bodyParser.json({ limit: "50mb" }) // 50mb — canvas images are base64
bodyParser.urlencoded({ extended: true, limit: "50mb" })
```

⚠️ The rate limiter runs **before** body parsing and keys on `req.ip` with no
`app.set("trust proxy")`. Behind a reverse proxy every user shares one bucket. See
[15](15-security-and-deployment.md).

---

## `GET /health`

No auth, no rate concerns. **The path is `/health`, not `/api/health`.**

```json
{
  "status": "ok",
  "service": "Amatic AI Backend",
  "timestamp": "2026-09-07T…",
  "models": { "claude": false, "gemini": false, "elevenlabs": false }
}
```

`models.*` is a **key-presence check only** (`!!process.env.X`). It does not validate the
key against the provider. `true` means "a string is set", not "this key works".

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
balancer, or `res.ok` check can detect a failure. The client only handles `voice`,
`visual_prompt`, `canvas_text`, `next_topic` and `done` — **it ignores `type: "error"`
entirely**, so a keyless backend produces total silence with no user feedback. See
[17](17-roadmap.md) P1.

**Model config:** `claude-sonnet-5`, `max_tokens: 64000`, `effort: medium`, adaptive
thinking, `stream: true`. No `temperature` — Sonnet 5 rejects it with a 400.

**Client disconnect** is handled: `req.on("close")` sets `aborted`, breaking the stream
loop so a closed tab stops burning tokens.

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

None of the following exists today:

- **Consistent error envelope.** Right now: JSON 400/500 on some routes, SSE-200-with-error
  on `master`, and a stub returning success.
- **Request IDs.** No correlation ID threads a turn through recognize → master → worker →
  TTS, so you cannot reconstruct a single teaching turn from logs.
- **`GET /metrics`.** No counters, no latency histograms, no token/cost gauges.
- **`/readyz` vs `/healthz`.** `/health` reports key presence, not provider reachability.
- **Versioning.** No `/api/v1` prefix, so any breaking change breaks all clients.
- **Timeouts and retries** on provider calls.
- **Idempotency keys** — a retried worker call regenerates (and re-bills) an image.

All of that is scoped in [18-implementation-plan.md](18-implementation-plan.md).
