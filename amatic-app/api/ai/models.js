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
  /** Teaching brain + drawing recognition. 1M input context, 128K max output. */
  TEACHING_MODEL: "claude-sonnet-5",
  /** Plain chat endpoints. Same model today; kept separate so the two call
   *  sites can diverge again without re-introducing hardcoded literals. */
  CHAT_MODEL: "claude-sonnet-5",
};
