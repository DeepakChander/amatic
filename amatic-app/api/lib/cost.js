/**
 * Token and cost accounting (docs/18 Phase 2.3).
 *
 * `recordLlmCall` emits one structured `llm_call` event per Claude call and
 * feeds the token/cost/latency metrics. `estimateCost` prices a usage block
 * from the rate table below.
 *
 * Rates are USD per million tokens, keyed by the model ids in
 * api/ai/models.js (never an inline literal — CLAUDE.md). Only the teaching
 * model is priced: that is the one rate docs/06-costs.md states. Gemini
 * image and ElevenLabs character pricing are plan-dependent and deliberately
 * left unpriced (their calls are counted, not costed). Cache reads are
 * billed at 10% of input and cache writes at 125% (5-minute TTL), per
 * Anthropic's published prompt-caching pricing. Update here, nowhere else.
 */

const metrics = require("./metrics");
const { TEACHING_MODEL, CHAT_MODEL } = require("../ai/models");

const SONNET_5_RATE = { input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 };

const RATES_PER_MTOK = {
  [TEACHING_MODEL]: SONNET_5_RATE,
  [CHAT_MODEL]: SONNET_5_RATE,
};

/** Price a usage object. Returns null when the model has no known rate. */
function estimateCost(model, usage) {
  const rate = RATES_PER_MTOK[model];
  if (!rate || !usage) return null;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const usd =
    (input * rate.input +
      output * rate.output +
      cacheRead * rate.cacheRead +
      cacheWrite * rate.cacheWrite) /
    1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * Record one Claude call.
 * @param {import('pino').Logger} log   request-scoped logger (req.log)
 * @param {object} p
 * @param {string} p.route      recognize|master|chat
 * @param {string} p.model
 * @param {object|null} p.usage Anthropic usage block (may be null on error)
 * @param {number} p.latencyMs
 * @param {"ok"|"error"|"aborted"} [p.outcome]  defaults from `ok`.
 *        "aborted" = the student interrupted or the stream stalled after
 *        tokens were already billed — not a provider error.
 * @param {boolean} [p.ok]
 * @param {Error} [p.error]
 * @returns {number|null} estimated cost in USD
 */
function recordLlmCall(log, { route, model, usage, latencyMs, ok, outcome, error, provider = "anthropic" }) {
  const finalOutcome = outcome ?? (ok ? "ok" : "error");
  // Tokens are billed whether or not the turn finished cleanly, so price
  // every usage block we have — otherwise interrupted turns under-report.
  const costUsd = estimateCost(model, usage);

  metrics.llmCalls.inc({ route, provider, outcome: finalOutcome });
  metrics.llmLatency.observe({ route, provider }, latencyMs);
  if (usage) {
    const add = (kind, n) => {
      if (n) metrics.llmTokens.inc({ model, kind }, n);
    };
    add("input", usage.input_tokens);
    add("output", usage.output_tokens);
    add("cache_read", usage.cache_read_input_tokens);
    add("cache_write", usage.cache_creation_input_tokens);
  }
  if (costUsd) metrics.llmCost.inc({ provider }, costUsd);

  const fields = {
    event: "llm_call",
    provider,
    model,
    route,
    outcome: finalOutcome,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    cache_read_input_tokens: usage?.cache_read_input_tokens ?? null,
    cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? null,
    cost_usd: costUsd,
    latency_ms: Math.round(latencyMs),
  };
  if (finalOutcome === "ok") {
    log.info(fields, "llm call complete");
  } else if (finalOutcome === "aborted") {
    log.info({ ...fields, reason: error?.message }, "llm call aborted");
  } else {
    log.warn(
      { ...fields, err_status: error?.status ?? null, err: error?.message },
      "llm call failed",
    );
  }
  return costUsd;
}

/**
 * Record one image request. Counted, not costed (image rate unknown).
 *
 * outcome: ok | empty | error | aborted (client went away) | library (served
 * from the vetted diagram library — no provider call happened at all, so it
 * must not touch the Gemini call/latency series; that is the whole point of
 * the library and counting it as a failed Gemini call would invert the signal).
 */
const IMAGE_CALL_OUTCOMES = { ok: "ok", aborted: "aborted" };

function recordImageCall(log, { latencyMs, outcome, error }) {
  metrics.imagesGenerated.inc({ outcome });
  if (outcome === "library") {
    log.info(
      { event: "image_call", source: "library", latency_ms: Math.round(latencyMs), outcome },
      "image served from vetted diagram library",
    );
    return;
  }
  const callOutcome = IMAGE_CALL_OUTCOMES[outcome] || "error";
  metrics.llmCalls.inc({ route: "worker", provider: "gemini", outcome: callOutcome });
  metrics.llmLatency.observe({ route: "worker", provider: "gemini" }, latencyMs);
  const fields = { event: "image_call", provider: "gemini", latency_ms: Math.round(latencyMs), outcome };
  if (outcome === "ok") log.info(fields, "image call complete");
  else if (outcome === "aborted") log.info(fields, "image call aborted by client");
  else log.warn({ ...fields, err: error?.message }, "image call failed");
}

/**
 * Record one speech synthesis. Counted by characters, not costed.
 * `cached` hits never reached the provider, so they are excluded from the
 * provider call/latency series (they have their own amatic_tts_cache_total).
 */
function recordTtsCall(log, { provider = "elevenlabs", cached = false, characters, bytes, latencyMs, ok, error }) {
  if (!cached) {
    metrics.llmCalls.inc({ route: "tts", provider, outcome: ok ? "ok" : "error" });
    metrics.llmLatency.observe({ route: "tts", provider }, latencyMs);
    if (ok) metrics.ttsCharacters.inc(characters);
  }
  const fields = { event: "tts_call", provider, cached, characters, bytes: bytes ?? null, latency_ms: Math.round(latencyMs), ok };
  if (ok) log.info(fields, "tts call complete");
  else log.warn({ ...fields, err: error?.message }, "tts call failed");
}

module.exports = { RATES_PER_MTOK, estimateCost, recordLlmCall, recordImageCall, recordTtsCall };
