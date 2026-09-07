# 15 — Security and Deployment

> **Do not deploy this as it stands.** The issues below are not hardening niceties; the
> first two are open financial and privacy exposure.

## What is already right

Credit where due:

- **Keys are server-side only.** The browser never receives a provider key. All three are
  read from `.env.local` in the Express process.
- **`.env.local` is not committed** and not generated.
- **Error detail is suppressed in production** — every endpoint gates `error.message`
  behind `process.env.NODE_ENV === "production"`.
- **CORS is an allowlist**, not `*`: `["http://localhost:3000", "http://localhost:5000"]`.
- **Input length caps** on every endpoint (10,000 chars for `master`, 5,000 for worker
  prompts and TTS text).
- **Client disconnect aborts the stream**, so a closed tab stops billing.

That is a better baseline than most prototypes. The gaps below are what stands between it
and production.

---

## Blocking issues

### 1. No authentication on any AI route — CRITICAL

Anything that can reach `:3001` can spend your Anthropic, Google and ElevenLabs credits.
There is no API key, no session check, no user identity anywhere in `server.js`.

On localhost this is fine. Exposed — even on a LAN — it is an unmetered bill payable by you.

**Minimum viable fix:** a shared secret in an `Authorization` header, validated by
middleware before the rate limiter. **Proper fix:** real user sessions, so spend is
attributable per student and abuse is traceable.

### 2. The rate limiter does not work behind a proxy — CRITICAL

```js
const ip = req.ip || req.socket?.remoteAddress || "unknown";
```

There is no `app.set("trust proxy")`, so behind any reverse proxy, load balancer or CDN
`req.ip` is **the proxy's address**. Every user in the world shares one 100-request bucket.
The first active student locks out everyone else.

**Fix:** `app.set("trust proxy", 1)` *and* re-tune the limit — see below.

### 3. The limit is mis-sized for the workload

100 requests / 60 s per IP. One teaching turn spends up to 3 worker calls **plus one TTS
call per sentence**. A verbose turn can approach the limit on its own, and a spurious 429
was observed during normal use on a cold server.

**Fix:** per-route limits — generous for `text-to-speech`, tighter for `worker` (the
expensive one) — and key on user identity rather than IP once auth exists.

### 4. In-memory rate limit state

`rateLimitStore` is a plain `Map`. It resets on restart and is per-process, so it provides
no protection across multiple instances. **Fix:** Redis, or an established middleware
backed by shared state.

---

## Privacy — needs a decision before any real student uses this

This product is aimed at **children**, and that changes the analysis.

| Data | Where it goes | Concern |
|---|---|---|
| Canvas drawings | Anthropic (vision), as base64 JPEG | Student work leaves the device |
| Voice audio | **Google**, via Chrome's Web Speech API | Not local processing. Chrome streams audio to Google servers |
| Voice transcripts | Anthropic, as `voiceTranscript` | Children's speech content |
| Spatial memory | Browser storage only | Not sent, but also not protected |

Things that do not exist and should:

- No consent flow
- No data-retention policy or statement
- No PII redaction before prompts leave the process
- No audit log of what was sent where
- Nothing addressing COPPA / GDPR-K / FERPA, which apply to education products for minors

**The Web Speech point deserves emphasis**: it is described in these docs as "free", and it
is — but the cost is that a third party receives children's audio. That is a product and
legal decision, not an engineering one, and it should be made explicitly rather than by
default.

Current industry practice for LLM logging is to run a redaction scanner **inline on the
prompt** before it becomes a log attribute, with originals either dropped or held in a
separately-controlled bucket on a short TTL. None of that exists here yet — and it must
exist *before* logging is added, or logging will make the problem worse.

---

## Operational gaps

| Gap | Consequence |
|---|---|
| **No structured logging** | `console.log` only. No request IDs, no way to reconstruct a turn |
| **No metrics** | No `/metrics`, no request counters, no latency histograms, no cost gauges |
| **No real health check** | `/health` checks key *presence*, not provider reachability. It will report healthy while every call 401s |
| **No graceful shutdown** | No SIGTERM handler. A deploy kills in-flight SSE streams mid-sentence |
| **No `unhandledRejection` / `uncaughtException` handling** | Process continues in an undefined state |
| **No timeouts on provider calls** | A hung request stalls a turn indefinitely |
| **No retries** | One 429 or 5xx silently loses part of a turn |
| **No circuit breaker** | A provider outage means every turn fails slowly instead of failing fast |
| **No API versioning** | No `/api/v1`; any breaking change breaks all clients |
| **No idempotency** | A retried worker call regenerates and re-bills an image |

Graceful shutdown is more than `server.close()` when the app streams: SSE responses are
long-lived, so shutdown is a coordinated drain across sockets, proxies and backpressure.
Deploying without it produces clipped audio and half-finished explanations for whoever is
mid-lesson.

---

## Pre-deployment checklist

**Blocking — do not ship without these**

- [ ] Authentication on `/api/ai/*` and `/api/voice/*`
- [ ] `app.set("trust proxy", …)` and re-tuned, per-route rate limits
- [ ] Shared rate-limit state (Redis) if running more than one instance
- [ ] Structured logging with correlation IDs and **PII redaction**
- [ ] Provider timeouts and bounded retries
- [ ] Graceful shutdown that drains SSE streams
- [ ] `unhandledRejection` / `uncaughtException` → log and exit
- [ ] A spend cap or budget alert per provider
- [ ] A privacy policy covering what leaves the device, and a consent flow

**Strongly recommended**

- [ ] `/metrics` with request, latency and token/cost series
- [ ] `/readyz` that actually pings providers, distinct from `/healthz`
- [ ] `helmet` for security headers
- [ ] CORS allowlist driven by env, not hard-coded localhost
- [ ] Request body limits reduced from 50 MB where possible
- [ ] `/api/v1` prefix

Full sequencing in [18-implementation-plan.md](18-implementation-plan.md).

**Sources**
- [What Is LLM Observability? A 2026 Architecture Guide](https://futureagi.com/blog/what-is-llm-observability-2026/)
- [Node.js API Best Practices in 2026](https://blog.openreplay.com/nodejs-api-best-practices-2026/)
- [Node Shutdown Without Broken Streams](https://medium.com/@Quaxel/node-shutdown-without-broken-streams-45cf35556cc3)
