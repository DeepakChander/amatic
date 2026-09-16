/**
 * Drawing Recognition Endpoint
 * Analyzes a canvas drawing image with Claude vision and returns a full
 * teaching brief: topic, expert Gemini visual prompts, canvas labels, and a
 * voice intro — ready to use without any further AI calls.
 *
 * The AI never narrates "I see you drew X". The brief is used silently in the
 * background so visuals appear on canvas instantly when the student finishes drawing.
 */

const { recordLlmCall } = require("../lib/cost");
const metrics = require("../lib/metrics");
const llm = require("../lib/llm");

/**
 * The brief shape, as a JSON schema. Handed to the provider as a structured-
 * output constraint so the model cannot return prose instead — the single
 * biggest reliability win when running a small local model (docs/07).
 */
const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    topic: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    visualBriefs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          style: { type: "string" },
          title: { type: "string" },
        },
        required: ["prompt", "title"],
      },
    },
    canvasLabels: {
      type: "array",
      items: {
        type: "object",
        properties: {
          content: { type: "string" },
          fontSize: { type: "integer" },
        },
        required: ["content"],
      },
    },
    voiceIntro: { type: "string" },
  },
  required: ["topic", "confidence", "visualBriefs", "canvasLabels", "voiceIntro"],
};

const SYSTEM_PROMPT = `You are an expert educational AI with deep knowledge across all subjects.
You are given a small thumbnail of a student's hand-drawn canvas.

Your job: identify what was drawn and generate a COMPLETE teaching brief in one response.
This brief will be used immediately to generate educational visuals for the student.

Respond with ONLY valid JSON — no markdown, no code blocks, just the raw JSON object.

The JSON must follow this exact structure:
{
  "topic": "Human Heart Anatomy",
  "confidence": "high",
  "visualBriefs": [
    {
      "prompt": "Detailed anatomical cross-section of a human heart showing left ventricle, right ventricle, left atrium, right atrium, aorta, and pulmonary arteries with clear labels. Medical illustration style, white background, ultra high definition.",
      "style": "photorealistic",
      "title": "Heart Anatomy"
    }
  ],
  "canvasLabels": [
    { "content": "Left Ventricle", "fontSize": 18 },
    { "content": "Aorta", "fontSize": 18 }
  ],
  "voiceIntro": "The heart pumps about 2,000 gallons of blood every single day."
}

RULES:
- confidence: "high" = clearly identifiable drawing, "medium" = plausible guess, "low" = unclear/abstract
- Generate 3-5 visualBriefs. Each prompt must be EXPERT-LEVEL for Gemini image generation.
  Include specific details: materials, colors, perspective, style, educational clarity.
  Think like a science textbook illustrator, not a generic image generator.
- voiceIntro: ONE sentence that starts teaching the topic immediately.
  NEVER say "I see you drew", "I can see", "I notice", or acknowledge the drawing at all.
  Start mid-thought as if already in the lesson: fact, question, or remarkable statement.
- canvasLabels: 2-4 short labels (max 25 chars each) for key elements of the topic.
- If the drawing is unclear, make your best educational guess and set confidence to "low".
- If it looks like text/an equation, set topic to the subject the equation/text belongs to.`;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { canvasImage } = req.body || {};

  if (!canvasImage || typeof canvasImage !== "string") {
    return res.status(400).json({ error: "canvasImage (base64) is required" });
  }

  const provider = llm.resolveLlmProvider();
  const model = llm.modelFor("recognize", provider);
  const { key: apiKey, name: keyName } = llm.apiKeyFor(provider);
  if (!apiKey) {
    return res.status(500).json({ error: `${keyName} not configured` });
  }

  // Recognition is a background operation: on any failure the client gets an
  // empty low-confidence brief and the turn falls through to the full path.
  const timeoutResult = {
    topic: "",
    confidence: "low",
    visualBriefs: [],
    canvasLabels: [],
    voiceIntro: "",
  };

  // Hard 20 s ceiling on the whole request. The SDK retries its own 15 s
  // per-attempt timeout, so without this an unlucky call could run
  // (retries + 1) × 15 s; aborting the signal cancels the in-flight attempt
  // and stops the SDK from retrying, so nothing keeps billing after we reply.
  const RECOGNIZE_DEADLINE_MS = 20_000;
  const deadline = new AbortController();
  const deadlineHandle = setTimeout(
    () => deadline.abort(),
    RECOGNIZE_DEADLINE_MS,
  );

  const log = req.log;
  const started = Date.now();
  const result = await (async () => {
    let response = null;
    try {
      response = await llm.generate({
        provider,
        route: "recognize",
        apiKey,
        system: SYSTEM_PROMPT,
        userContent: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: canvasImage },
          },
          {
            type: "text",
            text: "Analyze this student's hand-drawn canvas and return the teaching brief JSON.",
          },
        ],
        // Room for thinking plus the brief. A tight cap risks spending the
        // budget on thinking and truncating the JSON, which this endpoint's
        // caller swallows silently.
        maxTokens: provider === "anthropic" ? 8000 : 2048,
        // Fast background classification on the drawing hot path.
        effort: "low",
        // A schema, not just "return JSON" in the prompt. Small local models
        // are markedly more reliable with one, and it costs the hosted
        // providers nothing.
        json: BRIEF_SCHEMA,
        signal: deadline.signal,
      });

      recordLlmCall(log, {
        route: "recognize",
        provider,
        model,
        usage: response.usage,
        latencyMs: Date.now() - started,
        ok: true,
      });

      const rawText = (response.text || "").trim();

      // Strip markdown code fences if Claude wrapped it anyway
      const jsonText = rawText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

      const brief = JSON.parse(jsonText);

      const confidence = ["high", "medium", "low"].includes(brief.confidence)
        ? brief.confidence
        : "low";
      // The metric that says whether recognition works at all.
      metrics.recognizeConfidence.inc({ level: confidence });
      log.info(
        {
          event: "recognize_complete",
          confidence,
          topic: typeof brief.topic === "string" ? brief.topic.slice(0, 80) : "",
          visual_briefs: Array.isArray(brief.visualBriefs) ? brief.visualBriefs.length : 0,
        },
        "drawing recognized",
      );

      // Validate and sanitize the response shape
      return {
        topic: typeof brief.topic === "string" ? brief.topic : "",
        confidence,
        visualBriefs: Array.isArray(brief.visualBriefs)
          ? brief.visualBriefs
              .filter(
                (v) => v && typeof v.prompt === "string" && v.prompt.length > 10,
              )
              .slice(0, 5)
              .map((v) => ({
                prompt: String(v.prompt).slice(0, 1000),
                style: typeof v.style === "string" ? v.style : "photorealistic",
                title: typeof v.title === "string" ? v.title : "",
              }))
          : [],
        canvasLabels: Array.isArray(brief.canvasLabels)
          ? brief.canvasLabels
              .filter((l) => l && typeof l.content === "string")
              .slice(0, 4)
              .map((l) => ({
                content: String(l.content).slice(0, 30),
                fontSize: typeof l.fontSize === "number" ? l.fontSize : 18,
              }))
          : [],
        voiceIntro:
          typeof brief.voiceIntro === "string"
            ? brief.voiceIntro.slice(0, 300)
            : "",
      };
    } catch (err) {
      // Two failure classes share this path: the provider call failed (no
      // response) or it answered with something that is not the brief
      // schema (parse/validation). Both count as a failed recognition.
      metrics.recognizeConfidence.inc({ level: "failed" });
      if (!response) {
        recordLlmCall(log, {
          route: "recognize",
          model: TEACHING_MODEL,
          usage: null,
          latencyMs: Date.now() - started,
          ok: false,
          error: err,
        });
      }
      log.warn(
        {
          event: "recognize_failed",
          reason: deadline.signal.aborted
            ? "deadline"
            : response
              ? "unparseable_brief"
              : "provider_error",
          err: err.message,
          deadline_ms: RECOGNIZE_DEADLINE_MS,
        },
        "recognition failed, returning empty brief",
      );
      return timeoutResult;
    } finally {
      clearTimeout(deadlineHandle);
    }
  })();

  res.json(result);
};
