# 03 — The AI Teaching Loop

Everything here lives in `amatic-app/hooks/useCanvasJarvis.ts` (~800 lines).

## Phases

Exported as `JarvisPhase`, surfaced by the footer dot ([10](10-frontend-ui.md)):

| Phase | Meaning | Dot |
|---|---|---|
| `idle` | Not started / mic off | hidden |
| `watching` | Mic on, monitoring the canvas | green `#22c55e` |
| `listening` | Processing a voice transcript | orange `#f97316` |
| `teaching` | Turn in flight | blue `#3b82f6` |

## Stage 1 — Background recognition

`captureAndRecognize()` fires **while the student is still drawing**. It deliberately does
not wait for the debounce, so the brief is ready the instant they pause.

```
freedraw elements, excluding ids starting "ai-"
  -> take the LAST one
  -> exportThumbnail(api, [target], 384)   // 384px JPEG, quality 0.75
  -> quickImageHash(base64)                // first 120 chars, non-cryptographic
  -> cache hit? return immediately, no API call
  -> POST /api/ai/recognize
  -> store TeachingBrief in _recognitionHashCache (max 30 entries, FIFO eviction)
```

`TeachingBrief`:

```ts
{
  topic: string,
  confidence: "high" | "medium" | "low",
  visualBriefs: { prompt: string, style: string }[],   // 3-5 pre-built Gemini prompts
  canvasLabels: string[],
  voiceIntro: string,
  timestamp: number
}
```

**Failures are swallowed on purpose** — the `catch` is empty with the comment
*"silent background operation — never propagate"*. That is right for UX and wrong for
operations: a systematically failing recognition endpoint is invisible. See
[18](18-implementation-plan.md) Phase 2.

## Stage 2 — The debounce

`IDLE_DEBOUNCE_MS = 3000`. Three seconds of no scene change triggers `startTeaching()`.
`PROACTIVE_COOLDOWN_MS = 15000` then blocks the next *unprompted* turn, capping
unprompted turns at 20 per 5 minutes.

## Stage 3 — Turn start and interruption

`startTeaching()` first tears down anything running:

```ts
teachingAbortRef.current?.abort();      // cancels fetches
currentAudioRef.current?.pause();       // stops narration mid-sentence
voiceQueueRef.current = [];             // drops queued sentences
```

Then a fresh `AbortController` is threaded through every `fetch` in the turn. This is
correct and non-trivial — a student who draws again mid-explanation gets the new
explanation, not both overlapping.

Two guards run before any spend:

```ts
// low-confidence recognition + no explicit voice request  ->  say nothing
if (briefIsFresh && cached.confidence === "low" && !context.voice) {
  setJarvisPhase("watching");
  return;
}
```

Staying silent when unsure is a good product instinct. It is also a cost control.

## Stage 4 — The fast path

Engages only when `briefIsFresh && confidence === "high" && visualBriefs.length > 0`:

```ts
voiceQueueRef.current.push(cached.voiceIntro);   // starts speaking now
for (const vb of cached.visualBriefs) {
  dispatchWorker(vb.prompt, vb.style);           // images start rendering now
}
visualsAlreadyDispatched = true;
recognitionCacheRef.current = null;              // consume the cache
```

⚠️ **Known defect.** The comment claims prompts are "not capped to
`MAX_CONCURRENT_WORKERS`", but `dispatchWorker` returns early when
`activeWorkerCountRef >= 3`. Because this is a synchronous loop, briefs 4 and 5 are
**silently discarded, not queued**. Also, `workerFailedRef` is latched on the first
failure and blocks every later dispatch in the turn. See [17](17-roadmap.md) P1.

## Stage 5 — The master stream

`POST /api/ai/master` with:

| Field | Source |
|---|---|
| `message` | voice transcript, or latest user content, or a generic fallback |
| `canvasContext` | `canvasMonitor.extractSpatialContext()` |
| `userIntent` | derived from spatial context |
| `pointedElement` | if the student gestured at something |
| `memoryContext` | `spatialMemory.getConversationContext()` |
| `canvasImage` | 512px JPEG of the whole scene, `ai-` elements excluded |
| `teachingBrief` | topic/confidence/labels/intro, plus `visualsAlreadyDispatched` |

The response is SSE of normalized events. How the server gets them out of the model is
selected by `MASTER_OUTPUT_MODE` (`amatic-app/api/lib/master-events.js`):

- **`json`** (default) — the model writes one JSON object per line as text and the
  string-aware scanner of [16](16-decisions.md) ADR-003 cuts objects out of the text deltas.
- **`tools`** — the model calls typed tools (`speak`, `write_text`, `draw_image`,
  `suggest_next`, all `strict`). The API validates the arguments, so a malformed event is a
  typed `parser_reject` instead of lost content. One turn may take several model rounds
  (call tools → acknowledged → continue), capped at 6.

Both modes emit the same five event types below and count into
`amatic_master_events_total{mode,type}`. Switch the default only after a real session
shows equal event counts on both paths. Thinking deltas are ignored in both modes, which
is why adaptive thinking on Sonnet 5 did not break parsing, only added latency before
the first event. The system prompt is static per mode and carries a prompt-cache
breakpoint; watch `cache_read_input_tokens` on the `llm_call` event.

### Event types

| Event | Effect |
|---|---|
| `voice` | push to TTS queue; start playback if idle |
| `visual_prompt` | `dispatchWorker()` — **skipped if the fast path already dispatched** |
| `canvas_text` | text element at the flowing cursor, default `fontSize: 24` |
| `next_topic` | `"→ Next: …"` at `maxY + 30`, `fontSize: 16` |
| `done` | `markTeachingComplete()`, phase `watching`, start cooldown |

## Voice playback

`playNextVoice()` is a sequential recursive queue — one `HTMLAudioElement` at a time,
`URL.revokeObjectURL` on `onended`. Errors recurse to the next item rather than stalling.

One consequence worth knowing: **one TTS request per sentence.** A long explanation means
many round-trips. That is the dominant driver of ElevenLabs character spend
([06](06-costs.md)).

## Tuning constants

| Constant | Value | Raise it to… | Lower it to… |
|---|---|---|---|
| `IDLE_DEBOUNCE_MS` | 3000 | let students think longer before interrupting | feel snappier, risk cutting in |
| `PROACTIVE_COOLDOWN_MS` | 15000 | cut cost and chattiness | be more responsive |
| `BRIEF_TTL_MS` | 30000 | reuse briefs longer (cheaper, staler) | force fresher recognition |
| `MAX_CONCURRENT_WORKERS` | 3 | more images per turn (more cost) | fewer, cheaper turns |
| `MIN_VOICE_CONFIDENCE` | 0.65 | ignore more garbled speech | act on weaker transcripts |
| `IMAGES_PER_ROW` | 2 | wider image grids | narrower |

## What is missing from this loop

- **No retry on any call.** A single 429 or 5xx loses that part of the turn silently.
- **No timeout.** A hung provider request stalls the turn until the user draws again.
- **No telemetry.** Nothing records turn count, latency, token spend, or failure rate.
- **No transcript persistence.** Nothing is stored, so no session review and no evaluation
  data. This is the single biggest obstacle to knowing whether the teaching is any good.

## Next

- [04-api-reference.md](04-api-reference.md)
- [09-canvas-integration.md](09-canvas-integration.md) — how placement works
