/**
 * Whisper TTS Endpoint (real-time voice)
 * Same provider/cache path as text-to-speech; accepts { text, voice, speed }
 * for use-realtime-voice. Named voices map to provider voice ids.
 */

const { synthesize, resolveProvider, needsElevenLabsKey, ELEVEN_DEFAULT_VOICE } = require("../lib/tts");
const { recordTtsCall } = require("../lib/cost");

/** Flatter delivery than the narration endpoint — hence its own cache variant. */
const ELEVEN_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
};

module.exports = async (req, res) => {
  const started = Date.now();
  let characters = 0;
  const provider = resolveProvider();
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { text, voice } = req.body;
    characters = typeof text === "string" ? text.length : 0;

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

    // `voice` is a friendly name ("nova", "bella"); every one maps to Bella
    // today. Kept as a request field so a second voice needs no API change.
    void voice;

    const { buffer, mimeType, cached } = await synthesize({
      text,
      voice: ELEVEN_DEFAULT_VOICE,
      variant: "realtime",
      apiKey,
      provider,
      settings: ELEVEN_SETTINGS,
    });

    recordTtsCall(req.log, {
      provider,
      cached,
      characters,
      bytes: buffer.length,
      latencyMs: Date.now() - started,
      ok: true,
    });

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
