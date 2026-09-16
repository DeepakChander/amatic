/**
 * Unified Gemini Worker
 * Generates ONE hyper-realistic visual from Master AI prompt using Gemini Nano Banana.
 * Uses @google/genai (new SDK). Handles all worker IDs dynamically.
 */

const { geminiFor } = require("../lib/providers");
const { recordImageCall } = require("../lib/cost");
const { createDiagramLibrary } = require("../lib/diagram-library");

const library = createDiagramLibrary();

module.exports = async (req, res) => {
  // Declared outside the try so the catch can report real latency and tell
  // a client disconnect from a provider failure.
  const startTime = Date.now();
  let disconnect = null;
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
    const topic = typeof body.topic === "string" ? body.topic.slice(0, 200) : "";
    const title = typeof body.title === "string" ? body.title.slice(0, 200) : "";

    if (!prompt) {
      return res.status(400).json({ error: "Valid prompt required" });
    }
    if (prompt.length > 5000) {
      return res
        .status(400)
        .json({ error: "Prompt too long (max 5,000 characters)" });
    }

    /** The one success payload shape, used by both the library and generated paths. */
    const imageResponse = ({ source, imageBase64, imageMimeType, description }) => ({
      workerId,
      taskId: requestId,
      status: "success",
      source,
      generationTime: Date.now() - startTime,
      imageData: imageBase64,
      imageMimeType,
      imageUrl: `data:${imageMimeType};base64,${imageBase64}`,
      description,
      timestamp: new Date().toISOString(),
    });

    // Phase 3.3 — a human-vetted diagram for this topic beats a generated
    // one on both cost and correctness. Exact slug match only; a miss falls
    // through to live generation.
    if (topic) {
      const hit = library.lookup(topic, title);
      if (hit) {
        const imageBase64 = library.readBase64(hit);
        recordImageCall(req.log, { latencyMs: Date.now() - startTime, outcome: "library" });
        req.log.info({ event: "diagram_library_hit", slug: hit.slug, file: hit.file }, "served vetted diagram");
        return res.json(
          imageResponse({
            source: "library",
            imageBase64,
            imageMimeType: hit.mimeType,
            description: hit.title,
          }),
        );
      }
    }

    const apiKey =
      process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      // Library-only mode (docs/07 option 3): no paid image provider. The
      // library already missed above, so there is simply no image for this
      // topic. 204 rather than 500 — the turn continues with voice and
      // canvas labels, which docs/07 argues may be the better product anyway.
      recordImageCall(req.log, { latencyMs: Date.now() - startTime, outcome: "unavailable" });
      req.log.info(
        { event: "image_unavailable", topic: topic || null },
        "library miss and no image provider configured; skipping image",
      );
      return res.status(204).end();
    }

    // 60 s timeout, 2 retries on 429/5xx (Phase 1.3). A client that gives up
    // (turn interrupted, tab closed) cancels the generation instead of
    // paying for an image nobody will see.
    const ai = geminiFor("worker", apiKey);
    disconnect = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) disconnect.abort();
    });

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
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        abortSignal: disconnect.signal,
      },
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
      recordImageCall(req.log, { latencyMs: generationTime, outcome: "empty" });
      return res.status(500).json({
        workerId,
        status: "error",
        error: "Gemini did not return image data",
        generationTime,
        timestamp: new Date().toISOString(),
      });
    }

    recordImageCall(req.log, { latencyMs: generationTime, outcome: "ok" });

    res.json(
      imageResponse({
        source: "generated",
        imageBase64,
        imageMimeType,
        description: textDescription,
      }),
    );
  } catch (error) {
    const clientGone = !!disconnect?.signal.aborted;
    recordImageCall(req.log, {
      latencyMs: Date.now() - startTime,
      outcome: clientGone ? "aborted" : "error",
      error,
    });
    if (clientGone || res.writableEnded || res.destroyed) return; // client already gone
    const workerId = req.params?.id
      ? parseInt(req.params.id, 10)
      : req.body?.workerId || 1;
    req.log.error({ err: error, event: "worker_error", workerId }, "image generation failed");
    res.status(500).json({
      workerId,
      status: "error",
      ...(process.env.NODE_ENV === "production"
        ? {}
        : { error: error.message }),
    });
  }
};
