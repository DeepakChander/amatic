/**
 * Unified Gemini Worker
 * Generates ONE hyper-realistic visual from Master AI prompt using Gemini Nano Banana.
 * Uses @google/genai (new SDK). Handles all worker IDs dynamically.
 */

const { GoogleGenAI } = require("@google/genai");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const workerId = req.params?.id
      ? parseInt(req.params.id, 10)
      : req.body?.workerId || 1;
    const body = req.body || {};
    const prompt =
      typeof body.prompt === "string" ? body.prompt.trim() : "";
    const style = body.style === "3d" ? "3d" : "2d";
    const requestId = body.workerId;

    if (!prompt) {
      return res.status(400).json({ error: "Valid prompt required" });
    }
    if (prompt.length > 5000) {
      return res
        .status(400)
        .json({ error: "Prompt too long (max 5,000 characters)" });
    }

    const apiKey =
      process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Gemini API key not configured" });
    }

    const startTime = Date.now();
    const ai = new GoogleGenAI({ apiKey });

    const enhancedPrompt = `Generate a hyper-realistic educational image: ${prompt}.
Style: ${
      style === "3d"
        ? "Photorealistic 3D render, transparent background"
        : "Photorealistic 2D illustration"
    }.
Quality: Ultra-high definition, professional, educational clarity.
No text overlays or watermarks.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: enhancedPrompt,
      config: { responseModalities: ["TEXT", "IMAGE"] },
    });

    const generationTime = Date.now() - startTime;

    let imageBase64 = null;
    let imageMimeType = "image/png";
    let textDescription = "";

    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          imageBase64 = part.inlineData.data;
          imageMimeType = part.inlineData.mimeType || "image/png";
        } else if (part.text) {
          textDescription = part.text;
        }
      }
    }

    if (!imageBase64) {
      return res.status(500).json({
        workerId,
        status: "error",
        error: "Gemini did not return image data",
        generationTime,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`[Worker-${workerId}] Generated in ${generationTime}ms`);

    res.json({
      workerId,
      taskId: requestId,
      status: "success",
      generationTime,
      imageData: imageBase64,
      imageMimeType,
      imageUrl: `data:${imageMimeType};base64,${imageBase64}`,
      description: textDescription,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const workerId = req.params?.id
      ? parseInt(req.params.id, 10)
      : req.body?.workerId || 1;
    console.error(`[Worker-${workerId}] Error:`, error);
    res.status(500).json({
      workerId,
      status: "error",
      ...(process.env.NODE_ENV === "production"
        ? {}
        : { error: error.message }),
    });
  }
};
