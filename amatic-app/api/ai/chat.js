/**
 * AI Chat Endpoint
 * Main conversation handler using Claude Sonnet 4.5
 */

const { CHAT_MODEL } = require("./models");
const { anthropicFor } = require("../lib/providers");
const { recordLlmCall } = require("../lib/cost");

module.exports = async (req, res) => {
  try {
    // Validate HTTP method
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    let {
      message,
      canvasContext,
      voiceTranscript,
      conversationHistory,
      subject,
    } = req.body;

    if (!message && !voiceTranscript) {
      return res
        .status(400)
        .json({ error: "Message or voice transcript required" });
    }

    const userInput = String(voiceTranscript || message || "").trim();
    if (!userInput) {
      return res.status(400).json({ error: "Message or voice transcript required" });
    }
    if (userInput.length > 10000) {
      return res
        .status(400)
        .json({ error: "Message too long (max 10,000 characters)" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res
        .status(500)
        .json({ error: "Anthropic API key not configured" });
    }

    const client = anthropicFor("chat", apiKey);
    const safeSubject =
      subject != null ? String(subject).trim().slice(0, 500) : "";
    const subjectContext = safeSubject
      ? `\n\nSubject/context: ${safeSubject}.`
      : "";
    let contextStr = "";
    if (canvasContext && typeof canvasContext === "object") {
      try {
        contextStr = JSON.stringify(canvasContext).slice(0, 8000);
      } catch (_) {
        contextStr = "";
      }
    }
    const contextInfo = contextStr
      ? `\n\nCanvas Context:\n${contextStr}`
      : "";
    const prompt = `${userInput}${contextInfo}${subjectContext}`;

    const messages = [];
    if (conversationHistory && Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory.slice(-10)) {
        const role = msg.role === "assistant" ? "assistant" : "user";
        const content = typeof msg.content === "string"
          ? msg.content.trim().slice(0, 15000)
          : "";
        if (content) {
          messages.push({ role, content });
        }
      }
    }
    messages.push({ role: "user", content: prompt });

    const started = Date.now();
    let response;
    try {
      response = await client.messages.create({
        model: CHAT_MODEL,
        max_tokens: 8000, // raised: thinking shares this budget on Sonnet 5
        // temperature removed — Sonnet 5 400s on non-default sampling params.
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        messages,
      });
    } catch (error) {
      recordLlmCall(req.log, { route: "chat", model: CHAT_MODEL, usage: null, latencyMs: Date.now() - started, ok: false, error });
      throw error;
    }
    recordLlmCall(req.log, { route: "chat", model: CHAT_MODEL, usage: response.usage, latencyMs: Date.now() - started, ok: true });

    const textBlock = response.content?.find((b) => b.type === "text");
    const content =
      textBlock && "text" in textBlock ? textBlock.text : "";

    res.json({
      response: content,
      model: response.model || CHAT_MODEL,
      provider: "anthropic",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    req.log.error({ err: error, event: "chat_error" }, "chat failed");
    res.status(500).json({
      error: "Failed to generate response",
      ...(process.env.NODE_ENV === "production"
        ? {}
        : { details: error.message }),
    });
  }
};
