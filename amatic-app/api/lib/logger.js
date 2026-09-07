/**
 * Structured logging (docs/18 Phase 2.1).
 *
 * One pino root logger, JSON to stdout. Every request gets a child logger
 * carrying `turnId` and `route` (see correlation.js), so
 * `grep <turnId>` reconstructs one teaching turn across recognize → master →
 * workers → TTS.
 *
 * Redaction is not optional: this service handles children's drawings and
 * speech. Anything that could carry student content — canvas images, voice
 * transcripts, the message text, memory — is censored before it becomes a
 * log attribute. `canvasImage` is also megabytes of base64. Route code must
 * never log `req.body` wholesale; log the fields you need and let these
 * paths catch the rest.
 *
 * LOG_LEVEL   trace|debug|info|warn|error|fatal (default info)
 * LOG_PRETTY  "1" for human-readable output in a terminal (dev only; needs
 *             the pino-pretty dev dependency). Default: JSON.
 */

const pino = require("pino");

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-api-key"]',
  "body.canvasImage",
  "body.voiceTranscript",
  "body.message",
  "body.memoryContext",
  "body.text",
  "body.prompt",
  "canvasImage",
  "voiceTranscript",
  "memoryContext",
];

function buildTransport() {
  if (process.env.LOG_PRETTY !== "1") return undefined;
  try {
    require.resolve("pino-pretty");
  } catch {
    return undefined;
  }
  return {
    target: "pino-pretty",
    options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname" },
  };
}

const log = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  base: { service: "amatic-ai" },
  transport: buildTransport(),
});

module.exports = { log, REDACT_PATHS };
