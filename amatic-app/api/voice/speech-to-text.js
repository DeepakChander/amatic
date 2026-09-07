/**
 * Speech-to-Text Endpoint
 * Note: Web Speech API runs in browser (free)
 * This endpoint is for server-side transcription if needed
 */

module.exports = async (req, res) => {
  try {
    // Validate HTTP method
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Web Speech API runs in browser, this is just a passthrough
    // or for future Whisper API integration

    const { audioBlob } = req.body;

    if (!audioBlob) {
      return res.status(400).json({ error: "Audio data required" });
    }

    // For now, return success (browser handles transcription)
    res.json({
      transcript: "",
      message: "Use Web Speech API in browser for real-time transcription",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("STT error:", error);
    res.status(500).json({
      error: "Failed to transcribe",
      ...(process.env.NODE_ENV === "production"
        ? {}
        : { details: error.message }),
    });
  }
};
