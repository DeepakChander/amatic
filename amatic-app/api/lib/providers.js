/**
 * Provider client factories with timeouts and bounded retries.
 *
 * Implements docs/18 Phase 1.3. Every outbound provider call in api/** goes
 * through one of these so the budget rules live in one place:
 *
 *   route      per-attempt   retries   idle      notes
 *   recognize   15 s           1        —        hot path; the route also holds a
 *                                                20 s outer abort so retries can
 *                                                never stretch the request
 *   master      30 s           1        60 s     per-attempt covers the initial
 *                                                request only (time to headers);
 *                                                `idleMs` is the gap between
 *                                                stream deltas before master.js
 *                                                aborts the turn — never retried
 *   chat        60 s           2        —
 *   worker      60 s           2        —        Gemini image generation
 *   tts         20 s           2        —        ElevenLabs; the SDK timeout
 *                                                covers headers only, so the
 *                                                routes wrap the body read in
 *                                                withDeadline() as well
 *
 * What each SDK actually does (verified against the installed versions):
 *
 *  - @anthropic-ai/sdk: retries 408/409/429/5xx *and connection timeouts*,
 *    honours `retry-after` / `retry-after-ms`, exponential backoff with jitter.
 *    Because timeouts are retried, a slow-but-alive provider can cost
 *    (retries + 1) × timeoutMs — size budgets with that in mind.
 *  - @google/genai: retries its default retryable status list (429/5xx) via
 *    p-retry; it does NOT read `retry-after`. `httpOptions.timeout` is one
 *    timer for the whole call, so a timed-out attempt is not meaningfully
 *    retried. Pass `abortSignal` in the call config to cancel from a route.
 *  - elevenlabs: retries 408/429/5xx with exponential backoff + jitter, no
 *    `retry-after`. `timeoutInSeconds` aborts only until response headers
 *    arrive; the audio body must be bounded by the caller.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { GoogleGenAI } = require("@google/genai");
const { ElevenLabsClient } = require("elevenlabs");

const BUDGETS = Object.freeze({
  recognize: { timeoutMs: 15_000, maxRetries: 1 },
  master: { timeoutMs: 30_000, maxRetries: 1, idleMs: 60_000 },
  chat: { timeoutMs: 60_000, maxRetries: 2 },
  worker: { timeoutMs: 60_000, maxRetries: 2 },
  tts: { timeoutMs: 20_000, maxRetries: 2 },
  /** Readiness probes must be cheap and give up fast. */
  probe: { timeoutMs: 5_000, maxRetries: 0 },
});

function budgetFor(route) {
  const b = BUDGETS[route];
  if (!b) {
    throw new Error(`providers: unknown route budget "${route}"`);
  }
  return b;
}

/** Anthropic client for a route. */
function anthropicFor(route, apiKey) {
  const { timeoutMs, maxRetries } = budgetFor(route);
  return new Anthropic({ apiKey, timeout: timeoutMs, maxRetries });
}

/** Gemini client for a route. `attempts` includes the original request. */
function geminiFor(route, apiKey) {
  const { timeoutMs, maxRetries } = budgetFor(route);
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: timeoutMs,
      retryOptions: { attempts: maxRetries + 1 },
    },
  });
}

/**
 * ElevenLabs client plus the per-request options it needs. The Fern client
 * takes timeout/retries per call, not in the constructor, so callers spread
 * `requestOptions` as the last argument.
 */
function elevenLabsFor(route, apiKey) {
  const { timeoutMs, maxRetries } = budgetFor(route);
  return {
    client: new ElevenLabsClient({ apiKey }),
    requestOptions: {
      timeoutInSeconds: Math.ceil(timeoutMs / 1000),
      maxRetries,
    },
    timeoutMs,
  };
}

/**
 * Race a promise against a deadline. Used where an SDK has no timeout of its
 * own — e.g. reading a response body after the headers-only timeout has
 * already been cleared. `onTimeout` lets the caller tear down the underlying
 * stream so the provider request does not keep running (and billing).
 */
function withDeadline(promise, ms, label, onTimeout) {
  let handle;
  const deadline = new Promise((_, reject) => {
    handle = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms} ms`);
      err.code = "ETIMEDOUT";
      try {
        onTimeout?.();
      } catch {
        /* best effort */
      }
      reject(err);
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(handle));
}

/**
 * Read a Node/Web readable of audio chunks into one Buffer, bounded by `ms`.
 * On timeout the stream is destroyed so no more bytes are pulled.
 */
function collectAudio(stream, ms, label) {
  const chunks = [];
  const read = (async () => {
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  })();
  return withDeadline(read, ms, label, () => {
    if (typeof stream.destroy === "function") {
      stream.destroy();
    } else if (typeof stream.cancel === "function") {
      stream.cancel().catch(() => {});
    }
  });
}

module.exports = {
  BUDGETS,
  budgetFor,
  anthropicFor,
  geminiFor,
  elevenLabsFor,
  withDeadline,
  collectAudio,
};
