/**
 * Chat Simple Endpoint (voice-to-AI)
 * Thin wrapper for voice chat: accepts { message }, returns { response }.
 */

const { CHAT_MODEL } = require("../ai/models");
const { anthropicFor } = require("../lib/providers");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message required" });
    }
    if (message.length > 10000) {
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

    const response = await client.messages.create({
      model: CHAT_MODEL,
      max_tokens: 8000, // raised: thinking shares this budget on Sonnet 5
      // temperature removed — Sonnet 5 400s on non-default sampling params.
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages: [{ role: "user", content: message }],
    });

    const textBlock = response.content?.find((b) => b.type === "text");
    const content = textBlock && "text" in textBlock ? textBlock.text : "";

    res.json({
      response: content,
      model: response.model || CHAT_MODEL,
      provider: "anthropic",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Chat simple error:", error);
    res.status(500).json({
      error: "Failed to generate response",
      ...(process.env.NODE_ENV === "production"
        ? {}
        : { details: error.message }),
    });
  }
};
