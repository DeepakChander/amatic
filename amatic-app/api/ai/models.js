/**
 * Single source of truth for the Claude model IDs this backend calls.
 *
 * These strings used to be duplicated across chat.js, chat-simple.js,
 * master.js and recognize.js, and the copies drifted: two endpoints reported
 * `model: "claude-sonnet-4"` to the client while actually calling
 * `claude-sonnet-4-20250514`. Import from here instead of inlining a literal.
 *
 * Model IDs are exact and complete — never append a date suffix to an ID that
 * does not already carry one.
 */
module.exports = {
  // --- Anthropic (paid) — LLM_PROVIDER=anthropic ---------------------------
  /** Teaching brain + drawing recognition. 1M input context, 128K max output. */
  TEACHING_MODEL: "claude-sonnet-5",
  /** Plain chat endpoints. Same model today; kept separate so the two call
   *  sites can diverge again without re-introducing hardcoded literals. */
  CHAT_MODEL: "claude-sonnet-5",

  // --- Google AI Studio free tier (default) — LLM_PROVIDER=gemini ----------
  // No card required, ~1,500 requests/day. One teaching turn costs 2 calls,
  // so roughly 125 turns/day. See docs/07-open-source-alternatives.md.
  /** Teaching brain + drawing recognition. Vision-capable. */
  GEMINI_TEACHING_MODEL: "gemini-2.5-flash",
  /** Plain chat endpoints. */
  GEMINI_CHAT_MODEL: "gemini-2.5-flash",
  /** Image generation (already the only image provider). */
  GEMINI_IMAGE_MODEL: "gemini-2.5-flash-image",

  // --- Fully local via Ollama — LLM_PROVIDER=ollama ------------------------
  // Zero network, zero cost, zero accounts. Sized for a CPU-only machine with
  // ~16 GB RAM and no usable GPU (docs/07). Expect seconds-to-a-minute per
  // turn, not the sub-second of a hosted model. Pull with:
  //   docker compose -f docker-compose.ollama.yml exec ollama ollama pull qwen2.5vl:3b
  /** Teaching brain + drawing recognition. Vision-capable, ~3.2 GB. */
  OLLAMA_TEACHING_MODEL: process.env.OLLAMA_TEACHING_MODEL || "qwen2.5vl:3b",
  /** Plain chat endpoints. Text-only and smaller, so noticeably faster. */
  OLLAMA_CHAT_MODEL: process.env.OLLAMA_CHAT_MODEL || "qwen2.5:3b",
};
