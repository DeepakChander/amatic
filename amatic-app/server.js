/**
 * Amatic Living Learning Canvas - Express Backend Server
 *
 * Provides AI services:
 * - Claude (Master AI, drawing recognition, chat)
 * - Gemini (Visual generation)
 * - ElevenLabs (Voice synthesis)
 *
 * Observability (docs/18 Phase 2): every request carries an `x-turn-id`
 * (read or minted by the correlation middleware, echoed in the response),
 * logs are structured JSON via pino with student content redacted, and
 * Prometheus metrics are served on /metrics. /healthz is liveness, /readyz
 * is a cached provider probe.
 */

const path = require("path");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env.local"),
});

const { log } = require("./api/lib/logger");
const { correlation, TURN_ID_HEADER } = require("./api/lib/correlation");
const { metricsHandler } = require("./api/lib/metrics");
const {
  healthzHandler,
  readyzHandler,
  peekReadiness,
} = require("./api/lib/readiness");

const app = express();
const PORT = process.env.AI_SERVER_PORT || 3001;

const isProduction = process.env.NODE_ENV === "production";

// In-memory rate limiter: 100 requests per minute per IP
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 100;

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  let bucket = rateLimitStore.get(ip);
  if (!bucket) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitStore.set(ip, bucket);
  }
  if (now >= bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  bucket.count++;
  if (bucket.count > RATE_LIMIT_MAX) {
    req.log?.warn({ event: "rate_limited", ip }, "rate limit exceeded");
    return res.status(429).json({ error: "Too many requests" });
  }
  next();
}

// Middleware
app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:5000"],
    // Let the browser read the echoed turn id.
    exposedHeaders: [TURN_ID_HEADER],
  }),
);
app.use(correlation);

// ---------------------------------------------------------------------------
// Health, readiness, metrics — mounted BEFORE the rate limiter. Probes and
// scrapers must not share the per-IP bucket with user traffic, or an
// orchestrator sees 429s exactly when the system is busiest.
// ---------------------------------------------------------------------------
app.get("/healthz", healthzHandler);
app.get("/readyz", readyzHandler);
app.get("/metrics", metricsHandler);

// Legacy health check — the cheap "is it up, are keys set" call every doc
// points at. Still key presence only, still instant, still 200. It also
// carries the last /readyz result if one exists (null otherwise) so a
// reader can see provider reachability without a live probe.
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Amatic AI Backend",
    timestamp: new Date().toISOString(),
    models: {
      claude: !!process.env.ANTHROPIC_API_KEY,
      gemini: !!process.env.GOOGLE_AI_API_KEY,
      elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    },
    readiness: peekReadiness(),
  });
});

app.use(rateLimit);
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

// AI Chat endpoint
app.post("/api/ai/chat", require("./api/ai/chat.js"));

// Master Brain endpoint (Streaming)
app.post("/api/ai/master", require("./api/ai/master.js"));

// Drawing recognition — returns full teaching brief (topic, Gemini prompts, labels, voice intro)
app.post("/api/ai/recognize", require("./api/ai/recognize.js"));

// Visual orchestration
app.post(
  "/api/ai/visual/orchestrate",
  require("./api/ai/visual-orchestrate.js"),
);

// Voice endpoints
app.post("/api/voice/speech-to-text", require("./api/voice/speech-to-text.js"));
app.post("/api/voice/text-to-speech", require("./api/voice/text-to-speech.js"));
app.post("/api/voice/whisper-tts", require("./api/voice/whisper-tts.js"));
app.post("/api/voice/chat-simple", require("./api/voice/chat-simple.js"));

// Unified worker route (handles all worker IDs dynamically)
app.post("/api/ai/worker/:id", require("./api/ai/worker.js"));
// Also support legacy route without ID
app.post("/api/ai/worker", require("./api/ai/worker.js"));

// Client-reported end of a teaching turn (aggregates into turn_complete)
app.post("/api/telemetry/turn", require("./api/telemetry/turn.js"));

// Error handling (sanitize message in production)
app.use((err, req, res, next) => {
  (req.log || log).error({ err, event: "unhandled_route_error" }, "route threw");
  if (res.headersSent) return next(err);
  res.status(500).json({
    error: "Internal server error",
    ...(isProduction ? {} : { message: err.message }),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// ---------------------------------------------------------------------------
// Process-level safety (docs/18 Phase 1.5)
// An unhandled rejection or uncaught exception leaves the process in an
// undefined state. Node already exits on both by default; these handlers add
// the log line and a bounded drain so in-flight responses get a chance to
// finish. Restarting is the supervisor's job: `yarn start` runs the backend
// under nodemon (server:dev); in production use the container runtime.
// ---------------------------------------------------------------------------
const SHUTDOWN_GRACE_MS = 5_000;
let server = null;
let shuttingDown = false;

function shutdown(code, reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.error({ event: "shutdown", reason }, "shutting down");
  const forceExit = setTimeout(() => process.exit(code), SHUTDOWN_GRACE_MS);
  forceExit.unref();
  if (server) {
    // Idle keep-alive sockets would otherwise hold close() open for the
    // whole grace period; active SSE streams get up to SHUTDOWN_GRACE_MS.
    server.closeIdleConnections?.();
    server.close(() => process.exit(code));
  } else {
    process.exit(code);
  }
}

// Only the real process installs signal handlers and listens. Tests
// require() the app and bind their own ephemeral port.
if (require.main === module) {
  process.on("unhandledRejection", (err) => {
    log.fatal({ err, event: "unhandledRejection" }, "unhandled rejection");
    shutdown(1, "unhandledRejection");
  });
  process.on("uncaughtException", (err) => {
    log.fatal({ err, event: "uncaughtException" }, "uncaught exception");
    shutdown(1, "uncaughtException");
  });
  process.on("SIGTERM", () => shutdown(0, "SIGTERM"));
  process.on("SIGINT", () => shutdown(0, "SIGINT"));

  server = app.listen(PORT, () => {
    log.info({ event: "listening", port: Number(PORT) }, "Amatic AI backend listening");
  });
}

module.exports = app;
