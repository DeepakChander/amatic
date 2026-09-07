# 02 — Architecture Overview

## Two processes, one origin

```
┌─────────────────────────── browser ───────────────────────────┐
│  React app (Excalidraw fork) + useCanvasJarvis hook           │
│  Web Speech API (STT, free)   HTMLAudioElement (TTS playback)  │
└───────────────────────────────┬───────────────────────────────┘
                                │  all traffic to :3000
                    ┌───────────▼────────────┐
                    │  Vite dev server :3000 │
                    │  proxies /api/* ───────┼──┐
                    └────────────────────────┘  │
                                                │
                    ┌───────────────────────────▼──────────────┐
                    │  Express backend :3001  (amatic-app/     │
                    │  server.js)                              │
                    │    /api/ai/*     -> Anthropic, Google    │
                    │    /api/voice/*  -> ElevenLabs           │
                    │    /health                               │
                    └──────────────────────────────────────────┘
```

The browser never talks to :3001 directly and never holds a provider key. All three API
keys live server-side only, read from `.env.local`. That is the one genuinely sound
security decision in the current design — see [15](15-security-and-deployment.md) for the
rest, which is less good.

## Where the code lives

| Path | Role |
|---|---|
| `amatic-app/index.tsx` | Vite entry point |
| `amatic-app/App.tsx` | App shell; mounts `<Excalidraw>` and the Jarvis hook |
| `amatic-app/hooks/useCanvasJarvis.ts` | **The teaching loop.** The single most important file |
| `amatic-app/lib/ai/canvas-monitor.ts` | Watches the scene, builds spatial context, detects language |
| `amatic-app/lib/ai/spatial-memory.ts` | Conversation/placement memory across turns |
| `amatic-app/lib/voice/voice-monitor.ts` | Web Speech API wrapper (STT) |
| `amatic-app/components/AppFooter.tsx` | Footer row incl. the mic status dot |
| `amatic-app/server.js` | Express app, rate limiter, route registration |
| `amatic-app/api/ai/*.js` | AI endpoints (CommonJS) |
| `amatic-app/api/voice/*.js` | Voice endpoints (CommonJS) |
| `amatic-app/api/ai/models.js` | **Single source of truth for model IDs** |
| `packages/amatic/` | The editor library (Excalidraw fork) |
| `packages/{common,element,math,utils}` | Core packages |

Roughly **3,270 lines** of live AI code: ~2,150 client, ~1,120 server. A further
**~7,100 lines** under `amatic-app/lib/` are unreachable — see [14](14-dead-code.md).

## Request flow for one teaching turn

```
1.  canvas-monitor detects a scene change
2.  captureAndRecognize()  — fires immediately, does NOT await the debounce
      export last freedraw -> 384px JPEG
      POST /api/ai/recognize        (Claude, vision)
      cache TeachingBrief for 30s, keyed by image hash
3.  3s of no activity  (IDLE_DEBOUNCE_MS)
4.  startTeaching()
      aborts any in-flight turn (AbortController + audio.pause())
      if brief is fresh AND confidence === "high":
          queue voiceIntro, dispatch visualBriefs      <- FAST PATH
      POST /api/ai/master           (Claude, SSE, 512px thumbnail)
5.  for each SSE event:
      voice          -> POST /api/voice/text-to-speech -> audio queue
      visual_prompt  -> POST /api/ai/worker            -> image element
      canvas_text    -> text element
      next_topic     -> suggestion element
      done           -> phase = watching, 15s cooldown
```

The fast path exists so narration starts speaking while the master call is still
streaming. It is the difference between a tutor that feels instant and one that feels
laggy — and it only engages when recognition was high-confidence.

## Technology choices, as they stand

| Concern | Current | Assessment |
|---|---|---|
| Streaming | **SSE** over `fetch` + `ReadableStream` | Correct choice — unidirectional server→client. WebSocket would add complexity for nothing |
| Structured output | **Hand-rolled JSON scanner** over raw text deltas | Fragile. See [16](16-decisions.md) ADR-003 |
| Backend framework | Express 4 + CommonJS | Fine, but no logging, metrics, or lifecycle management |
| State | React refs inside one hook | Works; untestable in isolation |
| Persistence | **None** | No session history, no analytics, no audit trail |
| Auth | **None** | Blocking for deployment |
| Observability | `console.log` / `console.warn` | Blocking for production |

The client architecture is genuinely well thought out — the fast path, abort handling,
hash-based recognition cache and zone-aware placement are all non-obvious ideas
implemented correctly. **The backend is a prototype wearing production clothes.** That gap
is the subject of [18-implementation-plan.md](18-implementation-plan.md).

## Next

- [03-ai-teaching-loop.md](03-ai-teaching-loop.md) — the loop in depth
- [04-api-reference.md](04-api-reference.md) — endpoint contracts
