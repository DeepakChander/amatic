/**
 * Whisper TTS Endpoint (real-time voice)
 * Same ElevenLabs TTS as text-to-speech; accepts { text, voice, speed } for use-realtime-voice.
 */

const { elevenLabsFor, collectAudio } = require("../lib/providers");
const { recordTtsCall } = require("../lib/cost");

const VOICE_MAP = {
  nova: "EXAVITQu4vr4xnSDxMaL",
  bella: "EXAVITQu4vr4xnSDxMaL",
  default: "EXAVITQu4vr4xnSDxMaL",
};

module.exports = async (req, res) => {
  const started = Date.now();
  let characters = 0;
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { text, voice, speed = 1.0 } = req.body;
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
    if (!apiKey) {
      return res
        .status(500)
        .json({ error: "ElevenLabs API key not configured" });
    }

    const { client, requestOptions, timeoutMs } = elevenLabsFor("tts", apiKey);
    const voiceId = VOICE_MAP[voice?.toLowerCase()] || VOICE_MAP.default;

    const audio = await client.generate(
      {
        voice: voiceId,
        model_id: "eleven_multilingual_v2",
        text,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      },
      requestOptions,
    );

    // Body read bounded separately — the SDK timeout stops at the headers.
    const buffer = await collectAudio(audio, timeoutMs, "Whisper TTS body");

    recordTtsCall(req.log, {
      characters,
      bytes: buffer.length,
      latencyMs: Date.now() - started,
      ok: true,
    });

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
