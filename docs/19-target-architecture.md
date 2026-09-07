# 19 — Target Production Architecture

What this becomes if it goes to real students. Contrast with
[02-architecture-overview.md](02-architecture-overview.md), which documents what exists today.

---

## 1. Where we are

```
Browser ──► Vite dev server :3000 ──proxy──► Express :3001 ──► Anthropic
                                                            ├─► Google (Gemini)
                                                            └─► ElevenLabs
```

Single process, no state, no auth, no logs, no metrics, no persistence. Correct for a
prototype. Not deployable.

## 2. Where it needs to go

```
                       ┌──────────────────────────────┐
                       │  Browser (React + canvas)    │
                       │  useCanvasJarvis · Web Speech│
                       └───────────────┬──────────────┘
                                       │ HTTPS
                    ┌──────────────────▼──────────────────┐
                    │  CDN — static SPA bundle            │
                    └──────────────────┬──────────────────┘
                                       │ /api/v1/*
                    ┌──────────────────▼──────────────────┐
                    │  Edge / LB  (TLS, WAF, DDoS)        │
                    └──────────────────┬──────────────────┘
                                       │
     ┌─────────────────────────────────▼─────────────────────────────────┐
     │  API service — stateless, N replicas                              │
     │                                                                   │
     │  ① authn/authz      ② rate limit (Redis)   ③ correlation ID       │
     │  ④ request validation (zod)                ⑤ PII redaction        │
     │  ⑥ provider clients: timeout · retry · circuit breaker            │
     │  ⑦ structured logs → stdout      ⑧ /metrics  ⑨ /healthz /readyz   │
     └───┬───────────────┬───────────────┬───────────────┬───────────────┘
         │               │               │               │
         ▼               ▼               ▼               ▼
   ┌──────────┐   ┌────────────┐   ┌──────────┐   ┌──────────────┐
   │ Postgres │   │ Object     │   │  Redis   │   │ Job queue    │
   │ sessions │   │ storage    │   │ TTS cache│   │ image gen    │
   │ turns    │   │ thumbnails │   │ rate lim │   │ (async)      │
   │ events   │   │ images     │   │ sessions │   └──────┬───────┘
   └────┬─────┘   └─────┬──────┘   └──────────┘          │
        │               │                                 ▼
        │               │                          Gemini / image provider
        ▼               ▼
   ┌─────────────────────────────┐      ┌────────────────────────────┐
   │ Eval harness (offline)      │      │ Teacher review UI          │
   │ golden set · LLM-as-judge   │◄─────┤ correct + approve turns    │
   └─────────────────────────────┘      └────────────────────────────┘
```

## 3. Component decisions, and why

| Concern | Choice | Why this and not the alternative |
|---|---|---|
| **API framework** | Keep Express, or Fastify | Express is fine and already there. Fastify only if throughput becomes an issue — it won't; the bottleneck is provider latency, not the HTTP layer |
| **Streaming** | Keep **SSE** | Unidirectional server→client. WebSocket adds reconnect/heartbeat complexity for zero benefit here |
| **Structured output** | **Tool calls**, not hand-parsed JSON | Removes a whole bug class. See [16](16-decisions.md) ADR-003 |
| **Database** | **Postgres** | Relational queries ("every low-confidence recognition last week") plus JSONB for event payloads. Not because load demands it |
| **Object storage** | S3-compatible | Images and thumbnails do not belong in Postgres. Presigned URLs, lifecycle rules for retention |
| **Cache / rate limit** | **Redis** | The in-memory `Map` resets on restart and is per-process — useless with >1 replica |
| **Image generation** | **Async queue** + pre-generated library | Gemini is the slowest and most expensive call. Taking it off the request path is the single biggest latency win |
| **Logging** | **Pino** → stdout → aggregator | JSON, ~600k ops/sec, no files in containers |
| **Metrics** | `prom-client` → Prometheus → Grafana | Standard, cheap, no vendor lock |
| **Tracing** | OpenTelemetry, Express auto-instrumentation | One init line gets most of the value |
| **Auth** | Session cookie or JWT + per-user spend cap | Spend attribution is the point, not just access control |

## 4. The one architectural change that matters most

**Take image generation off the request path.**

Today a teaching turn holds a connection open while Gemini renders up to three images. That
makes the slowest, most expensive, most failure-prone provider a blocking dependency of the
student's experience.

```
now:     turn ──► master (stream) ──► worker ──► worker ──► worker ──► done
                                      └── student waits on all of it ──┘

target:  turn ──► master (stream) ──► narration starts immediately
                       └──► enqueue image jobs
                                  └──► worker pool ──► push to client when ready
```

Narration and labels arrive fast; images arrive when they arrive. That is both better UX
and the enabler for the diagram library — a cache hit returns instantly, a miss enqueues.

## 5. Data model

```sql
users      (id, external_id, role, created_at)
sessions   (id, user_id, started_at, ended_at, topic_summary)
turns      (id, session_id, turn_id UNIQUE, started_at, duration_ms,
            recognized_topic, confidence, cost_usd, outcome, model)
events     (id, turn_id, seq, type, payload JSONB, created_at)
artifacts  (id, turn_id, kind, storage_key, bytes, mime, created_at)
llm_calls  (id, turn_id, provider, model, input_tokens, output_tokens,
            cache_read_tokens, cost_usd, latency_ms, ok, created_at)
diagrams   (id, topic_key UNIQUE, storage_key, approved_by, approved_at)
```

`turn_id` is the correlation ID generated client-side and threaded through every request in
a turn ([18](18-implementation-plan.md) Phase 2). It is what makes a turn reconstructable
from logs *and* joinable in SQL.

`llm_calls` is what turns [06-costs.md](06-costs.md) from estimates into a dashboard.
`diagrams` is the vetted library that replaces per-turn generation.

## 6. Deployment topology

**Pilot (one class, ≤30 students)** — a single small VM or container host is genuinely
enough:

```
1× app container (512 MB–1 GB)   1× Postgres (small managed)   1× Redis (small)
Object storage bucket             Logs to a hosted aggregator
```

The API is stateless once the rate-limit `Map` moves to Redis, so scaling is horizontal
when needed. Provider rate limits will bind before your compute does.

**Do not build for scale you don't have.** The interesting constraints here are provider
quotas and cost per turn, not requests per second.

## 7. Environments

| Env | Purpose | Providers |
|---|---|---|
| local | development | real keys, low `effort`, images off |
| staging | eval runs, rehearsal | real keys, separate budget cap |
| production | students | real keys, per-user spend caps, alerting |

Separate API keys per environment so a runaway dev loop cannot exhaust the production
quota. Today there is one `.env.local` and no separation.

## 8. What this architecture deliberately does not include

- **Model hosting.** Local inference is not viable on the current hardware and is not
  worth a GPU budget yet ([07](07-open-source-alternatives.md)).
- **A microservice split.** One API service is correct at this size. Splitting recognition
  and teaching into separate services adds ops burden for no benefit.
- **Multi-region.** Latency to providers dominates; a second region wouldn't help.
- **A vector database.** There is no retrieval requirement today. Spatial memory is small
  and per-session.

Each of those is a real option later. None is justified now, and building them early would
be the most expensive mistake available.

## Next

- [20-storage-and-capacity.md](20-storage-and-capacity.md) — how much storage this needs
- [18-implementation-plan.md](18-implementation-plan.md) — the phased path to get here
