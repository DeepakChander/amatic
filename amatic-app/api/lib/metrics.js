/**
 * Prometheus metrics (docs/18 Phase 2.4), served on GET /metrics.
 *
 * The last three in the table are the ones that say whether the product
 * works at all — recognition confidence, parser rejects, dropped workers.
 * Nobody had that information before this file.
 */

const client = require("prom-client");

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: "amatic_" });

const httpRequests = new client.Counter({
  name: "amatic_http_requests_total",
  help: "HTTP requests handled, by matched route and status (status=aborted when the client left before the response ended)",
  labelNames: ["route", "status"],
  registers: [registry],
});

const httpLatency = new client.Histogram({
  name: "amatic_http_latency_ms",
  help: "HTTP request latency in milliseconds, by route",
  labelNames: ["route"],
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000],
  registers: [registry],
});

const turnsTotal = new client.Counter({
  name: "amatic_turns_total",
  help: "Teaching turns completed, by outcome (done|error|aborted)",
  labelNames: ["outcome"],
  registers: [registry],
});

const llmLatency = new client.Histogram({
  name: "amatic_llm_latency_ms",
  help: "Provider call latency in milliseconds, by route",
  labelNames: ["route", "provider"],
  buckets: [250, 500, 1000, 2000, 4000, 8000, 15000, 30000, 60000, 120000],
  registers: [registry],
});

const llmCalls = new client.Counter({
  name: "amatic_llm_calls_total",
  help: "Provider calls, by route, provider and outcome (ok|error|aborted)",
  labelNames: ["route", "provider", "outcome"],
  registers: [registry],
});

const llmTokens = new client.Counter({
  name: "amatic_llm_tokens_total",
  help: "Tokens billed, by model and kind (input|output|cache_read|cache_write)",
  labelNames: ["model", "kind"],
  registers: [registry],
});

const llmCost = new client.Counter({
  name: "amatic_llm_cost_usd_total",
  help: "Estimated spend in USD, by provider (only providers with a known rate)",
  labelNames: ["provider"],
  registers: [registry],
});

const recognizeConfidence = new client.Counter({
  name: "amatic_recognize_confidence_total",
  help: "Drawing recognitions, by reported confidence (high|medium|low|failed)",
  labelNames: ["level"],
  registers: [registry],
});

const parserRejects = new client.Counter({
  name: "amatic_parser_rejects_total",
  help: "Malformed JSON objects discarded from the master stream",
  registers: [registry],
});

const workerDropped = new client.Counter({
  name: "amatic_worker_dropped_total",
  help: "Image workers the client refused to dispatch, by reason (full|circuit|closed)",
  labelNames: ["reason"],
  registers: [registry],
});

const ttsCharacters = new client.Counter({
  name: "amatic_tts_characters_total",
  help: "Characters sent for speech synthesis",
  registers: [registry],
});

const imagesGenerated = new client.Counter({
  name: "amatic_images_generated_total",
  help: "Images returned by the image provider, by outcome (ok|empty|error|aborted)",
  labelNames: ["outcome"],
  registers: [registry],
});

async function metricsHandler(_req, res) {
  res.setHeader("Content-Type", registry.contentType);
  res.end(await registry.metrics());
}

module.exports = {
  registry,
  metricsHandler,
  httpRequests,
  httpLatency,
  turnsTotal,
  llmLatency,
  llmCalls,
  llmTokens,
  llmCost,
  recognizeConfidence,
  parserRejects,
  workerDropped,
  ttsCharacters,
  imagesGenerated,
};
