/**
 * Drawing Recognition Endpoint
 * Analyzes a canvas drawing image with Claude vision and returns a full
 * teaching brief: topic, expert Gemini visual prompts, canvas labels, and a
 * voice intro — ready to use without any further AI calls.
 *
 * The AI never narrates "I see you drew X". The brief is used silently in the
 * background so visuals appear on canvas instantly when the student finishes drawing.
 */

const { TEACHING_MODEL } = require("./models");
const { anthropicFor } = require("../lib/providers");

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Anthropic API key not configured" });
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

  const result = await (async () => {
    try {
      const client = anthropicFor("recognize", apiKey);

      const response = await client.messages.create({
        model: TEACHING_MODEL,
        // Raised from 2000: on Sonnet 5 thinking shares the max_tokens budget,
        // and a tight cap risks spending it on thinking and truncating the JSON
        // brief — which this endpoint's caller swallows silently.
        max_tokens: 8000,
        // temperature: 0.3 removed — Sonnet 5 400s on non-default sampling.
        // Determinism is steered by SYSTEM_PROMPT; note temperature never
        // guaranteed identical output anyway.
        thinking: { type: "adaptive" },
        // Fast background classification on the drawing hot path — low effort
        // keeps latency near the old thinking-off behaviour.
        output_config: { effort: "low" },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: canvasImage,
                },
              },
              {
                type: "text",
                text: "Analyze this student's hand-drawn canvas and return the teaching brief JSON.",
              },
            ],
          },
        ],
      }, { signal: deadline.signal });

      const rawText = response.content
        ?.find((b) => b.type === "text")
        ?.text?.trim() ?? "";

      // Strip markdown code fences if Claude wrapped it anyway
      const jsonText = rawText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

      const brief = JSON.parse(jsonText);

      // Validate and sanitize the response shape
      return {
        topic: typeof brief.topic === "string" ? brief.topic : "",
        confidence: ["high", "medium", "low"].includes(brief.confidence)
          ? brief.confidence
          : "low",
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
      console.error(
        deadline.signal.aborted
          ? `[Recognize] gave up after ${RECOGNIZE_DEADLINE_MS} ms`
          : `[Recognize] Error: ${err.message}`,
      );
      return timeoutResult;
    } finally {
      clearTimeout(deadlineHandle);
    }
  })();

  res.json(result);
};
