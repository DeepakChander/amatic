/**
 * Master-stream event extraction (docs/18 Phase 3.2).
 *
 * The teaching brain emits four kinds of student-facing events: speech,
 * an image to generate, a short canvas label, and a next-topic suggestion.
 * There are two ways to get them out of the model stream, selected by
 * MASTER_OUTPUT_MODE:
 *
 *   "json"  — the original design (docs/16 ADR-003): the model writes one
 *             JSON object per line as plain text and a string-aware scanner
 *             cuts complete objects out of the text deltas. Works, but any
 *             malformed object is a silent parse failure.
 *   "tools" — the model calls typed tools (speak, draw_image, write_text,
 *             suggest_next). The API validates arguments against the schema
 *             (`strict: true`), so "the model emitted malformed JSON" becomes
 *             a typed reject here instead of lost content. This is the
 *             direction docs/18 chooses; the scanner stays behind the flag
 *             until a real session shows equal event counts on both paths.
 *
 * Both parsers produce identical normalized events so master.js can treat
 * them alike, and both are pure (no I/O) so they are unit-tested with
 * synthetic stream chunks in tests/api/master-events.test.ts.
 */

const VALID_MODES = new Set(["json", "tools"]);

function resolveMode(raw = process.env.MASTER_OUTPUT_MODE) {
  const m = String(raw || "json").toLowerCase();
  return VALID_MODES.has(m) ? m : "json";
}

// ---------------------------------------------------------------------------
// Tool definitions — the contract the model is held to in "tools" mode
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "speak",
    description:
      "Say one short sentence of narration to the student (max 15 words). Call this first, and call it many times — one sentence per call.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "One spoken sentence." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "write_text",
    description:
      "Put a SHORT label, formula or title on the canvas (max 60 characters).",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Label text, max 60 chars." },
        fontSize: {
          type: "integer",
          description: "Font size in px, 14-36. Default 24.",
        },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "draw_image",
    description:
      "Request one educational image. Give an expert-level description for an image generator. Only when no visuals were already dispatched.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Detailed image description." },
        style: {
          type: "string",
          enum: ["photorealistic", "schematic", "3d", "2d"],
          description: "Rendering style. Default schematic.",
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "suggest_next",
    description:
      "Exactly once, at the end: one related concept the student could explore next.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        suggestion: { type: "string", description: "Concept name." },
        prompt: {
          type: "string",
          description: "A short question the student could ask about it.",
        },
      },
      required: ["suggestion"],
      additionalProperties: false,
    },
  },
];

/** Names → handlers that turn validated tool input into a normalized event. */
const TOOL_EVENTS = {
  speak: (i) => (typeof i.text === "string" && i.text.trim() ? { type: "voice", text: i.text } : null),
  // `content` is coerced because JSON mode may deliver a number here; the
  // tool schema already guarantees a string in tools mode.
  write_text: (i) => {
    const content = i.content == null ? "" : String(i.content);
    if (!content.trim()) return null;
    return {
      type: "canvas_text",
      content: content.slice(0, 60),
      x: 100,
      y: 100,
      fontSize: Number.isInteger(i.fontSize) ? Math.min(36, Math.max(14, i.fontSize)) : 24,
    };
  },
  draw_image: (i) =>
    typeof i.prompt === "string" && i.prompt.trim()
      ? { type: "visual_prompt", prompt: i.prompt, style: i.style || "schematic" }
      : null,
  suggest_next: (i) =>
    typeof i.suggestion === "string" && i.suggestion.trim()
      ? { type: "next_topic", suggestion: i.suggestion, prompt: typeof i.prompt === "string" ? i.prompt : "" }
      : null,
};

/**
 * Normalize a JSON-mode object into the same event shape, or null.
 *
 * Every branch goes through the same TOOL_EVENTS handler as tools mode, so
 * the two paths cannot drift: the 60-char label cap and the 14-36 fontSize
 * clamp apply identically. The flag exists to A/B the two paths, which is
 * only meaningful if they normalize the same way.
 */
const JSON_TYPE_TO_TOOL = {
  voice: "speak",
  visual_prompt: "draw_image",
  canvas_text: "write_text",
  next_topic: "suggest_next",
};

function normalizeJsonObject(obj) {
  if (!obj || typeof obj.type !== "string") return null;
  // "done" and unknown types are not student events.
  const tool = JSON_TYPE_TO_TOOL[obj.type];
  return tool ? TOOL_EVENTS[tool](obj) : null;
}

// ---------------------------------------------------------------------------
// System prompt tails — the OUTPUT FORMAT section differs per mode
// ---------------------------------------------------------------------------

const JSON_OUTPUT_INSTRUCTIONS = `OUTPUT FORMAT — JSON objects, one per line. Do NOT output markdown, do NOT wrap in code blocks.
- { "type": "voice", "text": "..." }
- { "type": "visual_prompt", "prompt": "detailed image description for Gemini image generation...", "style": "photorealistic" }
- { "type": "canvas_text", "content": "short label or formula", "fontSize": 20 }
- { "type": "next_topic", "suggestion": "one concept to explore next", "prompt": "short question the student can ask" }
- { "type": "done" }`;

const TOOLS_OUTPUT_INSTRUCTIONS = `OUTPUT FORMAT — use the tools, never plain text.
- speak(text) for every spoken sentence — one sentence per call, many calls per turn.
- write_text(content, fontSize) for each short canvas label or formula.
- draw_image(prompt, style) for each image (only when no visuals were already dispatched).
- suggest_next(suggestion, prompt) exactly once, last.
Issue several tool calls in one response rather than one at a time. Do not write prose outside tool calls; anything outside a tool call is discarded.`;

function outputInstructionsFor(mode) {
  return mode === "tools" ? TOOLS_OUTPUT_INSTRUCTIONS : JSON_OUTPUT_INSTRUCTIONS;
}

// ---------------------------------------------------------------------------
// Tools-mode parser: raw stream chunks → normalized events
// ---------------------------------------------------------------------------

/**
 * @param {object} h
 * @param {(event: object) => void} h.onEvent      validated student event
 * @param {(info: object) => void} [h.onReject]    a tool call that failed validation
 * @param {(chars: number) => void} [h.onText]     prose the model wrote outside tools
 */
function createToolEventParser({ onEvent, onReject = () => {}, onText = () => {} }) {
  /** index → { name, id, json } for tool_use blocks currently streaming */
  const open = new Map();
  let toolCalls = 0;

  return {
    /** Feed one raw stream event. Returns true if it was consumed here. */
    feed(chunk) {
      switch (chunk.type) {
        case "content_block_start": {
          const b = chunk.content_block;
          if (b?.type === "tool_use") {
            open.set(chunk.index, { name: b.name, id: b.id, json: "" });
            return true;
          }
          return false;
        }
        case "content_block_delta": {
          const d = chunk.delta;
          if (d?.type === "input_json_delta") {
            const t = open.get(chunk.index);
            if (t) t.json += d.partial_json || "";
            return true;
          }
          if (d?.type === "text_delta") {
            onText((d.text || "").length);
            return true;
          }
          return false;
        }
        case "content_block_stop": {
          const t = open.get(chunk.index);
          if (!t) return false;
          open.delete(chunk.index);
          toolCalls++;
          let input;
          try {
            // Always JSON.parse tool input — escaping differs between models.
            input = t.json.trim() ? JSON.parse(t.json) : {};
          } catch (err) {
            onReject({ tool: t.name, reason: "invalid_json", chars: t.json.length, err: err.message });
            return true;
          }
          const handler = TOOL_EVENTS[t.name];
          const event = handler ? handler(input) : null;
          if (!event) {
            onReject({ tool: t.name, reason: handler ? "invalid_input" : "unknown_tool" });
            return true;
          }
          onEvent(event);
          return true;
        }
        default:
          return false;
      }
    },
    /** Tool calls seen (valid or not). */
    get toolCalls() {
      return toolCalls;
    },
  };
}

// ---------------------------------------------------------------------------
// JSON-mode parser: text deltas → normalized events (the ADR-003 scanner)
// ---------------------------------------------------------------------------

/** Cap on retained partial-object text (chars). */
const MAX_BUFFER_CHARS = 100000;

/**
 * Index of the closing brace of the first complete JSON object in `s` (which
 * must start at s[0] === "{"), or -1 if it is not complete yet. Tracks string
 * literals and backslash escapes so an unbalanced brace inside a string
 * value cannot terminate the object early.
 */
function findObjectEnd(s) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * @param {object} h
 * @param {(event: object) => void} h.onEvent
 * @param {(info: object) => void} [h.onReject]  complete-but-invalid object, or buffer overflow
 */
function createJsonEventParser({ onEvent, onReject = () => {} }) {
  let buffer = "";

  const drain = () => {
    let rest = buffer;
    for (;;) {
      const start = rest.indexOf("{");
      if (start === -1) {
        // Prose between objects — nothing further to parse, and keeping it
        // would grow the buffer for the whole stream.
        rest = "";
        break;
      }
      if (start > 0) rest = rest.slice(start);
      const end = findObjectEnd(rest);
      if (end === -1) break; // still streaming — wait for more deltas
      const slice = rest.slice(0, end + 1);
      try {
        const event = normalizeJsonObject(JSON.parse(slice));
        if (event) onEvent(event);
      } catch (err) {
        onReject({ reason: "invalid_json", chars: slice.length, err: err.message });
      }
      rest = rest.slice(end + 1);
    }
    if (rest.length > MAX_BUFFER_CHARS) {
      // An unterminated object must not pin memory for the whole stream.
      onReject({ reason: "overflow", chars: rest.length });
      rest = "";
    }
    buffer = rest;
  };

  return {
    /**
     * Feed incremental model text. Takes a plain string: providers differ in
     * chunk shape, so api/lib/llm.js normalizes to text before this sees it.
     */
    feed(text) {
      if (typeof text !== "string" || text === "") return false;
      buffer += text;
      drain();
      return true;
    },
    /** Call once after the stream ends. */
    flush() {
      drain();
    },
  };
}

module.exports = {
  VALID_MODES,
  resolveMode,
  TOOLS,
  TOOL_EVENTS,
  normalizeJsonObject,
  outputInstructionsFor,
  createToolEventParser,
  createJsonEventParser,
  findObjectEnd,
  MAX_BUFFER_CHARS,
};
