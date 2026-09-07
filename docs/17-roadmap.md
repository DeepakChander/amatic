# 17 — Status, Weaknesses, and Demo Readiness

Written as an engineering assessment, not a status report. No rounding up.

---

## 1. How much is actually done

| Area | Complete | Notes |
|---|---|---|
| Canvas / editor | **100%** | Inherited from Excalidraw, works today, no keys needed |
| Teaching-loop client logic | **85%** code / **0%** validated | Well built. Has never executed |
| Backend endpoints | **70%** code / **0%** validated | Work as request-shapers; unproven against a provider |
| Voice output (TTS) | **80%** | Wired, unverified, no caching or retry |
| Voice input (STT) | **90%** | Actually works — browser-native, free |
| Canvas placement | **90%** | The strongest part of the codebase |
| Image generation | **60%** | Wired, but silently drops prompts past 3 |
| **Observability** | **0%** | `console.log`. No IDs, metrics, or cost tracking |
| **Auth** | **0%** | None |
| **Persistence** | **0%** | Nothing is stored. No session history |
| **Tests for AI code** | **0%** | ~3,270 live lines, zero coverage |
| **Evals** | **0%** | No way to know if a prompt change helps |
| Documentation | **90%** | This set |

### The honest headline

**Roughly 40% of a shippable product, and 0% validated.**

The distinction matters more than the number. This is not "60% of the work remaining" in
the sense of features to write — most features exist. It is that **nothing has ever run**,
so the true completion figure is unknowable. The first real API call could reveal that
recognition mis-identifies most drawings, or that the JSON event stream is unreliable, or
that it all works beautifully. Nobody knows, and no amount of further code review will
tell you.

---

## 2. Weak points

Ordered by how much damage each does.

### Critical

**1. It has never run.** Every quality claim — including the flattering ones in these docs
— is inference from source. The single highest-value action available is one keyed
Newton's-law session.

**2. Failure is invisible.** `master.js` emits `{"type":"error"}`; the client ignores it
entirely. Recognition failures are swallowed by a deliberately empty `catch`. A keyless or
failing backend produces **total silence** — a student cannot distinguish "thinking" from
"broken". For a product aimed at children, silent failure is the worst failure mode.

**3. No observability.** You cannot answer: how many turns happened, what did they cost,
what was the p95 latency, what fraction of recognitions were low-confidence, how often did
the JSON parser reject an event. Without those you are tuning blind.

**4. No authentication.** Anything reaching `:3001` spends your credits.

**5. No evals.** This is an LLM product with no measurement of output quality. Change a
prompt and you have no idea whether teaching improved. This is the difference between
engineering and guessing.

### Serious

**6. Silent data loss in the worker dispatch.** `dispatchWorker` drops prompts beyond 3
concurrent instead of queueing, and `workerFailedRef` latches so one Gemini error kills the
rest of the turn's visuals.

**7. No retries or timeouts anywhere.** One 429 loses part of a lesson.

**8. Nothing is persisted.** No transcript, no session record. This blocks evals, quality
review, parent/teacher reporting, and any analytics.

**9. Fragile structured output.** Hand-parsing JSON from a token stream works
([16](16-decisions.md) ADR-003) but is inherently brittle. Structured outputs or a tool call
would remove the class of bug.

**10. ~7,100 lines of dead code** that misdescribe the architecture.

### Moderate

**11.** 138 untriaged test failures · **12.** Chrome/Edge-only voice input ·
**14.** Rate limiter broken behind a proxy ·
**15.** Privacy posture undecided for a children's product

---

## 3. What is genuinely good

Not everything is a gap. These are non-obvious things done correctly:

- **The fast path.** Starting narration from a cached brief while `master` still streams is
  the difference between feeling instant and feeling laggy.
- **Interruption handling.** `AbortController` threaded through every fetch, audio paused,
  queue cleared. Draw again mid-explanation and you get the new explanation, not both.
- **Recognition hash cache.** Skips the vision call for a repeated drawing.
- **Zone-aware placement** that respects zoom and scroll, plus `CaptureUpdateAction.NEVER`
  so Ctrl+Z undoes the student's stroke and not the tutor's diagram.
- **The `ai-` prefix**, preventing the AI from recognising its own output.
- **Staying silent on low-confidence recognition.** A good product instinct and a cost
  control.
- **Server-side-only keys.**

Whoever designed the client loop understood the problem domain. **The gap is not design
quality — it is that the backend is a prototype wearing production clothes.**

---

## 4. Is it ready for a demo?

**No. Not today.** Three reasons, in order:

1. **No API keys.** The AI does literally nothing. A demo would be a whiteboard.
2. **It has never run once.** Demoing software whose core path has never executed is how
   you find out in front of an audience.
3. **The machine cannot hold the servers up.** They were killed 5+ times by memory
   pressure caused by a full C: drive ([13](13-troubleshooting.md)).

### What it takes to be demo-ready

**About 1–2 focused days**, in this order:

| # | Task | Time | Why |
|---|---|---|---|
| 1 | Fix the disk (pagefile → D:) | 30 min | Nothing is testable while processes die |
| 2 | ~~`git init`~~ **done** — `origin` → https://github.com/DeepakChander/amatic | — | ✅ complete |
| 3 | Add the three keys | 5 min | Unblocks everything |
| 4 | **Run one real session end to end** | 1 h | The only way to learn if this works |
| 5 | Surface AI errors in the UI | 2 h | Silence is not an acceptable demo failure |
| 6 | Add a "thinking…" indicator | 1 h | Adaptive thinking adds a visible pause |
| 7 | Fix the worker drop + add retries | 3 h | Stop losing visuals mid-demo |
| 8 | Log `usage` per call | 2 h | Know what the demo cost |
| 9 | Rehearse 3 topics on the real build | 2 h | Find the rough edges yourself |

Steps 1–4 are non-negotiable. 5–6 are what separate a demo that survives a hiccup from one
that dies in silence.

### Demo risks even after that

- **Latency.** 3 s debounce + adaptive thinking + TTS round-trip. Expect 5–10 s to first
  word. Rehearse so it doesn't read as "broken".
- **Recognition accuracy is unknown.** A hand-drawn diagram misread as something else is a
  bad look. Rehearse with drawings you know work.
- **Generated images may be subtly wrong.** For education that is worse than no image.
  Consider demoing with images off — narration plus labels is a cleaner story.
- **No provider fallback.** One outage ends the demo.

**My recommendation:** demo the **narration + canvas-labels** path with images disabled.
It is the more reliable half, it is cheaper, and it is arguably the better product
([07](07-open-source-alternatives.md)).

---

## 5. Priorities

### P0 — This week
1. Fix the disk · 2. ~~`git init`~~ ✅ done · 3. Add keys ·
4. **Run one real session** · 5. Log `usage` on every call

### P1 — Before any demo
6. Surface `{"type":"error"}` in the UI · 7. Loading state during thinking ·
8. Fix the worker drop and the `workerFailedRef` latch · 9. Timeouts + bounded retries ·
10. **Prompt caching on `master.js`** — the largest cost lever

### P2 — Before any real user
11. Auth on all AI routes · 12. `trust proxy` + per-route limits ·
13. Structured logging with correlation IDs and PII redaction ·
14. Graceful shutdown draining SSE · 15. Persist transcripts

### P3 — Before scale
16. Evals · 17. `/metrics` · 18. Provider fallback ·
19. Tests for the AI layer · 20. Triage the 138 failures · 21. Delete the dead code

Sequencing, effort, and acceptance criteria: [18-implementation-plan.md](18-implementation-plan.md).
