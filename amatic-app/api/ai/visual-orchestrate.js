/**
 * Visual Orchestration Endpoint
 * Master AI coordinates Gemini Nano Banana for visual generation.
 * Streams actual base64 images back via SSE.
 */

const { GoogleGenAI } = require("@google/genai");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body || {};
    const query =
      typeof body.query === "string" ? body.query.trim() : "";
    const complexity = body.complexity || "medium";

    if (!query) {
      return res.status(400).json({ error: "Valid query required" });
    }
    if (query.length > 5000) {
      return res
        .status(400)
        .json({ error: "Query too long (max 5,000 characters)" });
    }

    const apiKey =
      process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      return res
        .status(500)
        .json({ error: "Google AI API key not configured" });
    }

    const visualCounts = {
      simple: 10,
      medium: 50,
      complex: 150,
      comprehensive: 300,
    };
    const caps = {
      simple: 3,
      medium: 5,
      complex: 8,
      comprehensive: 10,
    };
    const plannedCount = Math.min(visualCounts[complexity] || 50, 300);
    const numVisuals = caps[complexity] ?? 5;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.write(
      `data: ${JSON.stringify({
        type: "status",
        phase: "planning",
        message: `Planning ${plannedCount} concepts, generating ${numVisuals} hyper-realistic visuals...`,
      })}\n\n`,
    );

    const ai = new GoogleGenAI({ apiKey });

    res.write(
      `data: ${JSON.stringify({
        type: "status",
        phase: "generating",
        total: numVisuals,
      })}\n\n`,
    );

    // Generate all images in parallel — 3-5x faster than sequential
    const genTimeout = (ms) =>
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Generation timeout")), ms),
      );

    const tasks = Array.from({ length: numVisuals }, (_, i) => {
      const prompt = `Educational illustration for: ${query}, concept ${
        i + 1
      }, hyper-realistic, photorealistic quality. No text overlays or watermarks.`;

      return Promise.race([
        ai.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: prompt,
          config: { responseModalities: ["TEXT", "IMAGE"] },
        }),
        genTimeout(30_000),
      ])
        .then((result) => ({ index: i, result, error: null }))
        .catch((error) => ({ index: i, result: null, error }));
    });

    const results = await Promise.all(tasks);

    for (const { index, result, error } of results) {
      if (error) {
        console.error(`Worker ${index} error:`, error);
        res.write(
          `data: ${JSON.stringify({
            type: "visual",
            id: `visual-${index}`,
            index,
            imageUrl: null,
            status: "failed",
            ...(process.env.NODE_ENV === "production"
              ? {}
              : { error: error.message }),
          })}\n\n`,
        );
        continue;
      }

      let imageBase64 = null;
      let imageMimeType = "image/png";
      const candidate = result.candidates?.[0];

      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.inlineData) {
            imageBase64 = part.inlineData.data;
            imageMimeType = part.inlineData.mimeType || "image/png";
            break;
          }
        }
      }

      res.write(
        `data: ${JSON.stringify({
          type: "visual",
          id: `visual-${index}`,
          index,
          imageUrl: imageBase64
            ? `data:${imageMimeType};base64,${imageBase64}`
            : null,
          description: `Concept ${index + 1}`,
          status: imageBase64 ? "generated" : "failed",
        })}\n\n`,
      );
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (error) {
    console.error("Orchestration error:", error);
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        message:
          process.env.NODE_ENV === "production"
            ? "Orchestration failed"
            : error.message,
      })}\n\n`,
    );
    res.end();
  }
};
