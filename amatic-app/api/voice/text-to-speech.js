/**
 * Text-to-Speech Endpoint
 * Uses ElevenLabs for natural voice synthesis
 */

const { elevenLabsFor, collectAudio } = require("../lib/providers");
const { recordTtsCall } = require("../lib/cost");

module.exports = async (req, res) => {
  const started = Date.now();
  let characters = 0;
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
    if (!apiKey) {
      return res
        .status(500)
        .json({ error: "ElevenLabs API key not configured" });
    }

    // 20 s to headers + 20 s for the body, 2 retries on 429/5xx (Phase 1.3).
    const { client, requestOptions, timeoutMs } = elevenLabsFor("tts", apiKey);
    const selectedVoice = voiceId || "EXAVITQu4vr4xnSDxMaL"; // Bella

    const streamResponse = await client.textToSpeech.convertAsStream(
      selectedVoice,
      {
        model_id: "eleven_multilingual_v2",
        text,
        voice_settings: {
          stability: 0.45,       // slightly looser = more natural variation
          similarity_boost: 0.75,
          style: 0.35,           // raised from 0.0 — adds expression and emotion to narration
          use_speaker_boost: true,
        },
      },
      requestOptions,
    );

    // Collect audio chunks. The SDK timeout above stops at the headers, so
    // a provider that stalls mid-body needs its own deadline or the client's
    // voice queue hangs on this sentence forever.
    const audioStream = streamResponse.data ?? streamResponse;
    const buffer = await collectAudio(audioStream, timeoutMs, "TTS body");

    recordTtsCall(req.log, {
      characters,
      bytes: buffer.length,
      latencyMs: Date.now() - started,
      ok: true,
    });

    // Return audio
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (error) {
    recordTtsCall(req.log, {
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
