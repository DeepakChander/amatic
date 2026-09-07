# 18 — Production Implementation Plan

Written from the perspective of taking ownership of this service. Sequenced so that each
phase makes the next one measurable, rather than by what is most interesting to build.

**The governing principle:** you cannot improve what you cannot see. Everything before
Phase 2 exists to make Phase 2 possible; everything after it depends on the data Phase 2
produces.

---

## Phase 0 — Make the system observable-by-existing (½ day)

Nothing here is a feature. All of it is a prerequisite.

| # | Task | Acceptance |
|---|---|---|
| 0.1 | Pagefile → D:, Disk Cleanup, Downloads → D: | ≥25 GB free on C:; servers survive 1 h |
| 0.2 | Move the project to `D:\amatic-main`, fresh `yarn install` | Runs from D:; `node_modules` out of OneDrive |
| 0.3 | `git init`, `.gitignore`, baseline commit | `git status` clean; `git log` has one commit |
| 0.4 | Create `.env.local` with all three keys | `/health` reports three `true` |
| 0.5 | **Run one real teaching session and record what happens** | A written note: did recognition identify the drawing? was the narration good? what did it cost? |
| 0.6 | `nodemon` for the backend | Editing `api/**` restarts automatically |

**0.5 is the most valuable hour in this entire document.** Every estimate in
[06-costs.md](06-costs.md) and every quality claim in these docs is inference. One real
session replaces all of it with fact.

---

## Phase 1 — Make failure visible (1–2 days)

Today the system fails silently in three separate places. This is the single largest defect
class, and for a children's product it is the one that matters most.

### 1.1 Surface AI errors in the UI

`master.js` already emits `{"type":"error", "message": "..."}`. The client's `processLine`
handles `voice`, `visual_prompt`, `canvas_text`, `next_topic` and `done` — and **ignores
`error`**. Add a branch, expose an `error` field from the hook, and render it near the
status dot.

Also make the status dot honest: add a **red** phase for `error`, so the indicator that
tells a student "I'm listening" can also tell them "I'm broken".

```ts
} else if (data.type === "error") {
  setJarvisError(data.message ?? "The tutor could not respond.");
  setJarvisPhase("error");
}
```

**Acceptance:** stop the backend, draw, and see a visible failure within 5 s.

### 1.2 Stop swallowing recognition failures

`captureAndRecognize`'s empty `catch` is correct for UX — a background failure should not
interrupt a student — and wrong for operations. Keep it non-fatal, but count and log it.

```ts
} catch (err) {
  metrics.recognizeFailures.inc();
  log.warn({ err, turnId }, "background recognition failed");
}
```

**Acceptance:** a systematically failing `recognize` shows up in logs and metrics within
one turn.

### 1.3 Timeouts and bounded retries on every provider call

None exist. A hung provider stalls the turn until the student draws again.

Rules I would apply:
- **Timeouts:** `recognize` 15 s (hot path, cache it and move on), `master` 120 s
  (streaming, long turns are legitimate), `worker` 60 s, `tts` 20 s.
- **Retry** only on 429 and 5xx, never on 4xx. Two attempts, exponential backoff with
  jitter, and **honour `retry-after`** when present.
- **Never retry `master` mid-stream.** Once bytes are on the wire the turn is
  non-idempotent; fail it and let the next draw trigger a new one.

### 1.4 Fix the worker dispatch defects

Two real bugs ([03](03-ai-teaching-loop.md) Stage 4):

- **Silent drop.** `dispatchWorker` returns early past 3 concurrent, so briefs 4–5 vanish.
  **Replace the counter with a bounded queue** (concurrency 3, queue depth 5).
- **The failure latch.** `workerFailedRef` blocks every later dispatch after one error.
  Make it per-worker; only trip a circuit after N consecutive failures.

**Acceptance:** with 5 briefs and a provider that fails the first call, the remaining 4
images still arrive.

### 1.5 Process-level safety

```js
process.on("unhandledRejection", (err) => { log.fatal({ err }); shutdown(1); });
process.on("uncaughtException",  (err) => { log.fatal({ err }); shutdown(1); });
```

Treat both as fatal and exit. Continuing in an undefined state is worse than restarting.

---

## Phase 2 — Observability (2–3 days)

This is where the project stops being a prototype.

### 2.1 Structured logging with Pino

`console.log` cannot be queried. Pino is the default high-performance Node logger —
JSON to stdout, ~600k ops/sec.

```js
const log = require("pino")({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["req.headers.authorization", "*.canvasImage", "*.voiceTranscript", "*.message"],
    censor: "[REDACTED]",
  },
});
```

**Redaction is not optional here.** This product processes children's drawings and speech.
Current practice is to redact **inline, before** the value becomes a log attribute, with
originals either dropped or held separately on a short TTL. Note `canvasImage` also needs
redacting simply because it is megabytes of base64.

### 2.2 Correlation IDs — the thing that makes logs useful

One teaching turn spans 5–8 HTTP requests across three providers. Without a shared ID you
cannot reconstruct it.

- Client generates a `turnId` in `startTeaching()` and sends it as `x-turn-id` on **every**
  request in that turn — recognize, master, each worker, each TTS call.
- Backend middleware reads or generates it, attaches a child logger, echoes it in the
  response.

```js
app.use((req, res, next) => {
  req.turnId = req.header("x-turn-id") ?? randomUUID();
  req.log = log.child({ turnId: req.turnId, route: req.path });
  res.setHeader("x-turn-id", req.turnId);
  next();
});
```

**Acceptance:** `grep <turnId>` returns the complete story of one teaching turn — every
call, its latency, its token usage, its outcome.

### 2.3 Token and cost accounting

Emit one structured event per provider call:

```js
req.log.info({
  event: "llm_call",
  provider: "anthropic", model: TEACHING_MODEL,
  input_tokens: u.input_tokens, output_tokens: u.output_tokens,
  cache_read_input_tokens: u.cache_read_input_tokens,
  cost_usd: estimateCost(u), latency_ms, ok: true,
}, "llm call complete");
```

And one `turn_complete` event aggregating the whole turn: calls made, images generated,
sentences spoken, total cost, wall-clock time.

**This is what turns [06-costs.md](06-costs.md) from a hypothesis into a dashboard.**
`cache_read_input_tokens` is also how you verify Phase 3.1 actually works.

### 2.4 Metrics endpoint

`prom-client` on `/metrics`:

| Metric | Type | Why |
|---|---|---|
| `amatic_turns_total{outcome}` | counter | throughput and success rate |
| `amatic_llm_latency_ms{route}` | histogram | p50/p95/p99 — the number users feel |
| `amatic_llm_tokens_total{model,kind}` | counter | spend attribution |
| `amatic_llm_cost_usd_total{provider}` | counter | the bill, live |
| `amatic_recognize_confidence{level}` | counter | **is recognition actually working?** |
| `amatic_parser_rejects_total` | counter | is the JSON stream reliable? |
| `amatic_worker_dropped_total` | counter | are we losing images? |

The last three are the ones that will tell you whether this product works. Nobody
currently has that information.

### 2.5 Real health checks

Split the endpoint:

- **`/healthz`** — liveness. Is the process up? Cheap, no dependencies.
- **`/readyz`** — readiness. Can it actually reach the providers? A cached
  30 s probe, not a live call per request.

Today's `/health` reports key *presence*. It will happily report healthy while every
request 401s.

---

## Phase 3 — Correctness and cost (2–3 days)

### 3.1 Prompt caching — do this first, it is free money

`master.js` re-sends its large static system prompt on **every turn** at full price. Add
`cache_control: { type: "ephemeral" }` to the system block: cached input drops to roughly
10% of cost.

Caching is a **prefix match**, so ordering matters:

```
[ frozen system prompt        ]  <- cache_control here
[ canvas context, image, memory ] <- volatile, AFTER the breakpoint
```

**Verify with `usage.cache_read_input_tokens`.** If it stays 0 across turns, something in
the prefix is varying — a timestamp, unsorted JSON, a changing tool list.

### 3.2 Replace hand-parsed JSON with structured output

The string-aware scanner ([16](16-decisions.md) ADR-003) is correct but brittle by nature.
Two better options:

1. **Structured outputs** (`output_config.format`) with a schema for the event union.
2. **Tool calls** — define `speak`, `draw_image`, `write_text`, `suggest_next` as tools and
   let the SDK parse them.

I would take (2). It removes an entire bug class, gives you per-event validation, and turns
"the model emitted malformed JSON" from a silent parse failure into a typed error.

**Keep the scanner behind a flag during migration** and compare event counts between paths
before switching.

### 3.3 Image strategy — the real cost decision

Images are almost certainly the dominant line item, and generated diagrams are frequently
*subtly wrong* for education in ways a student will not catch.

**What I would build: a pre-generated, human-vetted diagram library.**

- School curricula are finite. Newton's laws, photosynthesis, the water cycle — a few
  hundred topics covers an enormous fraction of real usage.
- Generate once, have a teacher approve, store, serve by topic lookup.
- Falls back to live generation only on a miss.

This converts a per-turn variable cost into a one-time cost, **and** puts a human in the
loop on pedagogical accuracy. It is better on cost *and* better on quality — the rare case
where those align.

Interim: cut `MAX_CONCURRENT_WORKERS` to 1. ~67% off the largest line item.

### 3.4 TTS caching and Kokoro

Cache synthesised audio by `hash(text + voice + lang)`. Stock phrases like "Let's look at
what you drew" are currently re-synthesised and re-billed every single time.

Then migrate to **Kokoro-82M** behind a `TTS_PROVIDER` flag
([08](08-voice-pipeline.md)) — it runs faster than real time on this CPU and removes a paid
provider with no quality cliff. Keep the flag so you can A/B narration quality rather than
cutting over blind.

---

## Phase 4 — Persistence (3–4 days)

**Nothing is stored today.** This blocks evals, quality review, teacher reporting, and any
analytics. It is the biggest structural gap after observability.

Minimum schema:

```
sessions   (id, user_id, started_at, ended_at, topic_summary)
turns      (id, session_id, turn_id, started_at, duration_ms,
            recognized_topic, confidence, cost_usd, outcome)
events     (id, turn_id, type, payload, created_at)   -- voice/text/image/error
artifacts  (id, turn_id, kind, storage_ref)           -- thumbnails, generated images
```

Postgres. Not because the load demands it, but because you will want relational queries
("show me every low-confidence recognition last week") and JSON columns for payloads.

**Retention must be decided before this is built, not after.** Turn payloads contain
children's drawings and speech. Short TTL on raw content, longer on aggregates.

`spatial-memory.ts` should then write through to the server instead of browser-only
storage, so a session survives a cleared cache and becomes reviewable.

---

## Phase 5 — Evals (ongoing, start after Phase 4)

**This is what separates a demo from a product.** Right now, change a prompt and you have
no idea whether teaching got better or worse.

1. **Build a golden set.** 50–100 drawings with known correct topics. Harvest from Phase 4
   data — real student drawings beat synthetic ones.
2. **Measure recognition first.** It is the cheapest to evaluate and the highest leverage:
   a wrong topic poisons the entire downstream turn. Accuracy against the golden set is a
   single number you can hill-climb.
3. **Then grade explanations.** LLM-as-judge on rubric dimensions — factual accuracy,
   age-appropriateness, length. Sample human review to validate the judge.
4. **Gate prompt changes on the eval.** No prompt change ships without a score.

Recognition accuracy is the metric I would put on the wall. If it is below ~85%, no amount
of narration quality saves the product.

---

## Phase 6 — Security and multi-tenancy (1 week)

Detail in [15-security-and-deployment.md](15-security-and-deployment.md). In order:

1. **Auth on `/api/ai/*` and `/api/voice/*`.** Even a shared secret beats nothing today.
2. **`app.set("trust proxy")`** + per-route limits (generous TTS, tight worker), keyed on
   user once identity exists.
3. **Redis-backed rate limiting** — the in-memory `Map` resets on restart and is
   per-process.
4. **Per-user spend caps.** With auth in place, cap cost per student per day. This is the
   only real protection against a runaway loop.
5. **Graceful shutdown that drains SSE.** With long-lived streams, shutdown is a
   coordinated drain, not `server.close()`. Without it every deploy clips someone's lesson
   mid-sentence.
6. **`helmet`**, env-driven CORS, reduced body limits.
7. **Privacy:** consent flow, retention policy, and an explicit decision on Web Speech
   sending children's audio to a third party.

---

## Phase 7 — Resilience and scale

- **Provider fallback.** One Anthropic outage currently ends every lesson. A configured
  fallback model, or a graceful "let's try again" narration.
- **Circuit breakers** per provider — fail fast instead of 20 slow timeouts.
- **`/api/v1` prefix.** Version before you have clients, not after.
- **Idempotency keys** on `worker` so a retry doesn't regenerate and re-bill an image.
- **Horizontal scale:** the backend is stateless apart from the rate-limit `Map`; move that
  to Redis and it scales out.
- **Tests for the AI layer.** ~3,270 live lines at zero coverage. Start with the parser
  (pure, easy) and the placement maths.

---

## If this were my product

Direct answers to what I would do differently, and why.

**1. Tool calls over hand-parsed JSON.** The current scanner is well-written but it is
defending against a problem that shouldn't exist. Tools give validation for free and turn
silent corruption into typed errors.

**2. A vetted diagram library instead of live image generation.** Cheaper, and — more
importantly — a human can check that the diagram of a cell is actually correct. In
education, a confidently wrong visual is worse than no visual.

**3. Persist everything from day one.** Not for analytics vanity: because without stored
turns you cannot build evals, and without evals you are guessing about the only thing that
matters. I would have built Phase 4 before Phase 3.

**4. Recognition accuracy as the north-star metric.** Everything downstream is conditional
on identifying the drawing correctly. I would instrument and hill-climb that before
touching narration quality.

**5. A teacher-in-the-loop mode.** The most valuable feature not currently planned: let a
teacher see what the AI told a student, correct it, and have that correction feed the eval
set. It solves quality assurance and data collection with one feature, and it is the thing
schools will actually ask for.

**6. Ship narration-only first.** The voice + labels path is the reliable half, it is
cheap, and it is a coherent product. Images can follow once the library exists.

**7. Latency budget as a first-class constraint.** 3 s debounce + thinking + TTS
round-trip is 5–10 s to first word. For a tutor that is the difference between magic and
frustration. I would set a p95 target of 4 s to first audio and treat it as a
release-blocking metric.

---

## Effort summary

| Phase | Effort | Blocking for |
|---|---|---|
| 0 — Stabilise | ½ day | everything |
| 1 — Visible failure | 1–2 days | any demo |
| 2 — Observability | 2–3 days | every decision after it |
| 3 — Correctness & cost | 2–3 days | sustainable spend |
| 4 — Persistence | 3–4 days | evals, reporting |
| 5 — Evals | ongoing | knowing if it works |
| 6 — Security | 1 week | any real user |
| 7 — Scale | 1–2 weeks | more than one class |

**~3 weeks of focused work to a defensible pilot.** Phases 0–2 are eight days and change
the project from unmeasurable to instrumented — which is the only step that makes the rest
of this plan meaningful rather than speculative.

**Sources**
- [LLM Application Architecture: A 2026 Engineer's Guide — MLflow](https://mlflow.org/articles/llm-application-architecture-a-2026-engineers-guide/)
- [What Is LLM Observability? A 2026 Architecture Guide](https://futureagi.com/blog/what-is-llm-observability-2026/)
- [Node.js API Best Practices in 2026](https://blog.openreplay.com/nodejs-api-best-practices-2026/)
- [Pino Logging in Node.js — Better Stack](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/)
- [Node Shutdown Without Broken Streams](https://medium.com/@Quaxel/node-shutdown-without-broken-streams-45cf35556cc3)
