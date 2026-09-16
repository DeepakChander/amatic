/**
 * Real health checks (docs/18 Phase 2.5).
 *
 *  /healthz — liveness. Process is up. No dependencies, always 200.
 *  /readyz  — readiness. Can we actually reach the providers with the keys
 *             we have? Probes are cheap list/lookup calls, run concurrently,
 *             each bounded by the "probe" budget, and the combined result is
 *             cached for READY_CACHE_MS so a scraper cannot turn this into a
 *             provider DoS. 200 when every configured provider answers, 503
 *             otherwise, with per-provider detail either way.
 *
 * The old /health reported key *presence* and would say healthy while every
 * request 401'd. It is kept for compatibility but now delegates to this.
 */

const { anthropicFor, geminiFor, elevenLabsFor, budgetFor, withDeadline } = require("./providers");
const { probeTts, resolveProvider: resolveTtsProvider } = require("./tts");

const READY_CACHE_MS = 30_000;
let cached = null; // { at, result }
let inflight = null; // Promise while a probe round is running

async function probeAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { configured: false, ok: false, reason: "no key" };
  const client = anthropicFor("probe", key);
  await client.models.list({ limit: 1 });
  return { configured: true, ok: true };
}

async function probeGemini() {
  const key = process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
  if (!key) return { configured: false, ok: false, reason: "no key" };
  const ai = geminiFor("probe", key);
  const { timeoutMs } = budgetFor("probe");
  await ai.models.list({ config: { pageSize: 1, abortSignal: AbortSignal.timeout(timeoutMs) } });
  return { configured: true, ok: true };
}

async function probeElevenLabs() {
  // When speech comes from local Kokoro, ElevenLabs is not a dependency and
  // its (possibly absent) key must not fail readiness.
  if (resolveTtsProvider() !== "elevenlabs") {
    return (await probeTts()) || { configured: false, ok: false, reason: "not the active TTS provider" };
  }
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { configured: false, ok: false, reason: "no key" };
  const { client, requestOptions } = elevenLabsFor("probe", key);
  await client.user.get(requestOptions);
  return { configured: true, ok: true };
}

async function runProbe(name, fn) {
  const { timeoutMs } = budgetFor("probe");
  const started = Date.now();
  try {
    const r = await withDeadline(fn(), timeoutMs + 500, `${name} probe`);
    return { ...r, latency_ms: Date.now() - started };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      reason: err?.status ? `HTTP ${err.status}` : err?.code || err?.message || "error",
      latency_ms: Date.now() - started,
    };
  }
}

async function runProbeRound() {
  const now = Date.now();
  const [claude, gemini, elevenlabs] = await Promise.all([
    runProbe("anthropic", probeAnthropic),
    runProbe("gemini", probeGemini),
    runProbe("elevenlabs", probeElevenLabs),
  ]);
  const providers = { claude, gemini, elevenlabs };
  const configured = Object.values(providers).filter((p) => p.configured);
  const ready = configured.length > 0 && configured.every((p) => p.ok);
  const result = { ready, providers, checked_at: new Date(now).toISOString() };
  cached = { at: now, result };
  return result;
}

async function checkReadiness() {
  const now = Date.now();
  if (cached && now - cached.at < READY_CACHE_MS) {
    return { ...cached.result, cached: true };
  }
  // Callers that arrive while a round is running share it. Without this,
  // a probe scraper, an orchestrator and a developer curl landing in the
  // same 5 s window would each fire their own three provider calls.
  if (!inflight) {
    inflight = runProbeRound().finally(() => {
      inflight = null;
    });
  }
  const result = await inflight;
  return { ...result, cached: false };
}

/**
 * The last readiness result without triggering a probe — for cheap
 * endpoints that must answer instantly (legacy /health). Null until the
 * first /readyz call has run.
 */
function peekReadiness() {
  return cached ? { ...cached.result, cached: true } : null;
}

function healthzHandler(_req, res) {
  res.json({ status: "ok", uptime_s: Math.round(process.uptime()) });
}

async function readyzHandler(_req, res) {
  const result = await checkReadiness();
  res.status(result.ready ? 200 : 503).json(result);
}

/** Test/ops hook: forget the cached probe result. */
function resetReadinessCache() {
  cached = null;
}

module.exports = {
  checkReadiness,
  peekReadiness,
  healthzHandler,
  readyzHandler,
  resetReadinessCache,
  READY_CACHE_MS,
};
