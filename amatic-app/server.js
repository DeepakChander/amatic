/**
 * Amatic Living Learning Canvas - Express Backend Server
 *
 * Provides AI services:
 * - Claude Sonnet 4.5 (Master AI)
 * - Gemini Nano Banana (Visual generation)
 * - ElevenLabs (Voice synthesis)
 */

const path = require("path");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env.local"),
});

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
    return res.status(429).json({ error: "Too many requests" });
  }
  next();
}

// Middleware
app.use(cors({ origin: ["http://localhost:3000", "http://localhost:5000"] }));
app.use(rateLimit);
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

// Health check
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
  });
});

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

// Error handling (sanitize message in production)
app.use((err, req, res, next) => {
  res.status(500).json({
    error: "Internal server error",
    ...(isProduction ? {} : { message: err.message }),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Start server
app.listen(PORT, () => {
  // Server started successfully
});

module.exports = app;
