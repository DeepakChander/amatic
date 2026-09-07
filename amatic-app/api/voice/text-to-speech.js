/**
 * Text-to-Speech Endpoint
 * Uses ElevenLabs for natural voice synthesis
 */

const ElevenLabs = require("elevenlabs").ElevenLabsClient;

module.exports = async (req, res) => {
  try {
    // Validate HTTP method
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { text, voiceId, lang } = req.body;

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

    const client = new ElevenLabs({ apiKey });
    const selectedVoice = voiceId || "EXAVITQu4vr4xnSDxMaL"; // Bella

    console.log(`[TTS] Generating speech for ${text.length} characters (lang: ${lang || "en-US"})...`);

    const streamResponse = await client.textToSpeech.convertAsStream(selectedVoice, {
      model_id: "eleven_multilingual_v2",
      text,
      voice_settings: {
        stability: 0.45,       // slightly looser = more natural variation
        similarity_boost: 0.75,
        style: 0.35,           // raised from 0.0 — adds expression and emotion to narration
        use_speaker_boost: true,
      },
    });

    // Collect audio chunks from the streaming response
    const chunks = [];
    const audioStream = streamResponse.data ?? streamResponse;
    for await (const chunk of audioStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    console.log(`[TTS] Generated ${buffer.length} bytes of audio`);

    // Return audio
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (error) {
    console.error("TTS error:", error);
    res.status(500).json({
      error: "Failed to generate speech",
      ...(process.env.NODE_ENV === "production"
        ? {}
        : { details: error.message }),
    });
  }
};
