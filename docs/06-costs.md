# 06 — Costs

## Read this first

**Nothing here is measured.** No API call has ever been made from this codebase — no keys
have been configured. Every figure below is derived from reading the code and applying
published rates. Token counts in particular are estimates with real error bars, because
adaptive thinking length cannot be predicted without observing it.

To replace estimates with facts, see [How to measure](#how-to-measure) at the end.

## Published rates

| Provider | Model | Rate |
|---|---|---|
| Anthropic | `claude-sonnet-5` | **$2.00 / MTok input, $10.00 / MTok output** |
| Google | `gemini-2.5-flash-image` | **not verified — check current pricing** |
| ElevenLabs | `eleven_multilingual_v2` | **not verified — character-based, plan-dependent** |

I am deliberately not guessing at the Gemini and ElevenLabs numbers. Structurally, image
generation is very likely the dominant line item.

## What one teaching turn spends

| Call | Count per turn | Provider |
|---|---|---|
| `/api/ai/recognize` | 1 (often 0 — cache hit) | Claude |
| `/api/ai/master` | 1 | Claude |
| `/api/ai/worker` | **up to 3** | Gemini |
| `/api/voice/text-to-speech` | **1 per sentence** | ElevenLabs |

## Estimated Claude cost per turn

| | Input tokens | Output tokens | Cost |
|---|---|---|---|
| `recognize` | ~700–1,000 | ~500–1,500 | ~$0.007–$0.017 |
| `master` | ~2,500–4,000 | ~1,500–4,500 | ~$0.020–$0.053 |
| **Total** | | | **~$0.03–$0.07** |

Output is billed at 5× input, and **adaptive thinking counts as output**. That is the
single largest source of uncertainty in this table.

## Worked example: 5 minutes on Newton's laws

`PROACTIVE_COOLDOWN_MS = 15000` caps unprompted turns at 20 per 5 minutes. Real pacing is
slower — draw, pause 3s, listen to 30–45s of narration — so **4–8 turns** is realistic.
Assume 6.

| Component | Volume | Cost |
|---|---|---|
| Claude | 6 turns | **~$0.18–$0.42** |
| Gemini images | ~18 images | **unverified — likely dominant** |
| ElevenLabs | ~4,000–6,000 chars | **unverified** |

Extrapolating Claude only: 30 students × 30 min/day ≈ **$30–$75/day**, with images
plausibly several times that.

## Cost controls already in the code

Credit where due — these are real and deliberate:

| Control | Effect |
|---|---|
| Recognition hash cache (30s TTL, 30 entries) | Skips the vision call for a repeated drawing |
| Low-confidence guard | Stays silent rather than spending on a bad read |
| `PROACTIVE_COOLDOWN_MS` | Caps unprompted turns |
| `AbortController` on every fetch | A new turn stops paying for the old one |
| `req.on("close")` in `master.js` | A closed tab stops burning tokens mid-stream |
| `MAX_CONCURRENT_WORKERS = 3` | Caps images per turn |

That last one caps cost **by silently discarding** briefs beyond 3 — a cost control by
accident, a correctness bug by design. See [03](03-ai-teaching-loop.md) Stage 4.

## The biggest saving available: prompt caching

**There is no prompt caching anywhere.** `master.js` re-sends its large static system
prompt on **every single turn** at full input price.

Adding `cache_control: { type: "ephemeral" }` to the system block cuts cached input to
roughly 10% of cost. Since that prompt is most of `master`'s input tokens, this is the
highest-value change available and costs nothing in quality.

Caveats worth knowing before implementing:
- Caching is a **prefix match** — any byte change invalidates everything after it. Keep the
  frozen system prompt first and volatile content (canvas context, timestamps) last.
- Verify with `usage.cache_read_input_tokens`. If it is zero across repeated turns,
  something in the prefix is varying.
- There is a minimum cacheable prefix length; short prefixes silently don't cache.

## Other levers, ranked

1. **Prompt caching** — free win, do it first
2. **Cut images from 3 to 1 per turn** — ~67% off the likely-dominant line item
3. **Batch TTS per paragraph instead of per sentence** — fewer round-trips, though it
   delays first audio, which is a real UX tradeoff
4. **Tune `effort` down on `master`** — measure before assuming `medium` is needed
5. **Raise `PROACTIVE_COOLDOWN_MS`** — fewer, better turns
6. **Raise `BRIEF_TTL_MS`** — more cache hits, staler briefs

## How to measure

Estimates become facts in about an hour of work:

1. **Log `response.usage` on every Claude call.** `input_tokens`, `output_tokens`,
   `cache_read_input_tokens`, `cache_creation_input_tokens`. For streams, read it off the
   final message.
2. **Emit a structured cost event per turn** with a correlation ID tying recognize →
   master → worker → TTS together, so a turn's total cost is one query away. See
   [18](18-implementation-plan.md) Phase 2.
3. **Run `count_tokens`** against a representative `master` payload to size the system
   prompt exactly.
4. **Record one real Newton's-law session** and compare against this page. Then delete
   these estimates and replace them with the measurements.

Until step 4 happens, treat this whole document as a hypothesis.

## Next

- [07-open-source-alternatives.md](07-open-source-alternatives.md) — the zero-cost path
- [18-implementation-plan.md](18-implementation-plan.md) — where cost telemetry gets built
