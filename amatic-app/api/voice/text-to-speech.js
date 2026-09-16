/**
 * Text-to-Speech Endpoint
 *
 * Provider (ElevenLabs or local Kokoro) and the hash-keyed audio cache live
 * in api/lib/tts.js — see TTS_PROVIDER there. Cached sentences return in
 * milliseconds and cost nothing.
 */

const { synthesize, resolveProvider, needsElevenLabsKey } = require("../lib/tts");
const { recordTtsCall } = require("../lib/cost");

module.exports = async (req, res) => {
  const started = Date.now();
  let characters = 0;
  const provider = resolveProvider();
  try {
    // Validate HTTP method
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { text, voiceId, lang } = req.body;
    characters = typeof text === "string" ? text.length : 0;

    // Validate text
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Valid text required" });
    }
    if (text.length > 5000) {
      return res
        .status(400)
        .json({ error: "Text too long (max 5,000 characters)" });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (needsElevenLabsKey(provider) && !apiKey) {
      return res
        .status(500)
        .json({ error: "ElevenLabs API key not configured" });
    }

    // The client's voice id goes through unfiltered — providers that do not
    // take one (Kokoro) ignore it. `variant` keeps this endpoint's voice
    // settings from colliding in the cache with /api/voice/whisper-tts.
    const { buffer, mimeType, cached } = await synthesize({
      text,
      voice: voiceId,
      lang,
      variant: "narration",
      apiKey,
      provider,
    });

    recordTtsCall(req.log, {
      provider,
      cached,
      characters,
      bytes: buffer.length,
      latencyMs: Date.now() - started,
      ok: true,
    });

    // Return audio
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("X-TTS-Provider", provider);
    res.setHeader("X-TTS-Cache", cached ? "hit" : "miss");
    res.send(buffer);
  } catch (error) {
    recordTtsCall(req.log, {
      provider,
      cached: false,
      characters,
      latencyMs: Date.now() - started,
      ok: false,
      error,
    });
    res.status(500).json({
      error: "Failed to generate speech",
      ...(process.env.NODE_ENV === "production"
        ? {}
        : { details: error.message }),
    });
  }
};
