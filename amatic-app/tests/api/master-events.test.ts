/**
 * docs/18 Phase 3.2 — both master-stream parsers must produce the same
 * normalized events, and the tools parser must turn malformed model output
 * into typed rejects instead of silent loss.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const events = require("../../api/lib/master-events.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { systemPromptFor } = require("../../api/lib/master-prompt.js");

type Ev = Record<string, unknown>;

const collect = () => {
  const out: Ev[] = [];
  const rejects: Ev[] = [];
  return {
    out,
    rejects,
    onEvent: (e: Ev) => out.push(e),
    onReject: (r: Ev) => rejects.push(r),
  };
};

/** Raw stream chunks for one tool_use block, split into arbitrary deltas. */
const toolChunks = (index: number, name: string, json: string, pieces = 3) => {
  const step = Math.ceil(json.length / pieces);
  const deltas = [];
  for (let i = 0; i < json.length; i += step) {
    deltas.push({
      type: "content_block_delta",
      index,
      delta: {
        type: "input_json_delta",
        partial_json: json.slice(i, i + step),
      },
    });
  }
  return [
    {
      type: "content_block_start",
      index,
      content_block: { type: "tool_use", id: `tu_${index}`, name, input: {} },
    },
    ...deltas,
    { type: "content_block_stop", index },
  ];
};

const textChunks = (text: string, pieces = 4) => {
  const step = Math.ceil(text.length / pieces);
  const out = [];
  for (let i = 0; i < text.length; i += step) {
    out.push({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: text.slice(i, i + step) },
    });
  }
  return out;
};

describe("resolveMode", () => {
  it("defaults to json and accepts only known modes", () => {
    expect(events.resolveMode(undefined)).toBe("json");
    expect(events.resolveMode("tools")).toBe("tools");
    expect(events.resolveMode("TOOLS")).toBe("tools");
    expect(events.resolveMode("yaml")).toBe("json");
  });
});

describe("tools-mode parser", () => {
  it("emits normalized events for each valid tool call, across split deltas", () => {
    const c = collect();
    const p = events.createToolEventParser(c);
    const chunks = [
      ...toolChunks(
        0,
        "speak",
        JSON.stringify({ text: "The heart pumps 2,000 gallons a day." }),
      ),
      ...toolChunks(
        1,
        "write_text",
        JSON.stringify({ content: "Left Ventricle", fontSize: 18 }),
      ),
      ...toolChunks(
        2,
        "draw_image",
        JSON.stringify({
          prompt: "Cross-section of a human heart",
          style: "photorealistic",
        }),
      ),
      ...toolChunks(
        3,
        "suggest_next",
        JSON.stringify({
          suggestion: "Blood Pressure",
          prompt: "How does blood pressure work?",
        }),
      ),
    ];
    for (const ch of chunks) {
      p.feed(ch);
    }
    expect(c.rejects).toEqual([]);
    expect(c.out).toEqual([
      { type: "voice", text: "The heart pumps 2,000 gallons a day." },
      {
        type: "canvas_text",
        content: "Left Ventricle",
        x: 100,
        y: 100,
        fontSize: 18,
      },
      {
        type: "visual_prompt",
        prompt: "Cross-section of a human heart",
        style: "photorealistic",
      },
      {
        type: "next_topic",
        suggestion: "Blood Pressure",
        prompt: "How does blood pressure work?",
      },
    ]);
    expect(p.toolCalls).toBe(4);
  });

  it("rejects malformed JSON, unknown tools and empty inputs with a typed reason", () => {
    const c = collect();
    const p = events.createToolEventParser(c);
    for (const ch of toolChunks(0, "speak", '{"text": "unterminated')) {
      p.feed(ch);
    }
    for (const ch of toolChunks(1, "dance", JSON.stringify({ moves: 3 }))) {
      p.feed(ch);
    }
    for (const ch of toolChunks(2, "speak", JSON.stringify({ text: "   " }))) {
      p.feed(ch);
    }
    expect(c.out).toEqual([]);
    expect(c.rejects.map((r) => r.reason)).toEqual([
      "invalid_json",
      "unknown_tool",
      "invalid_input",
    ]);
    expect(c.rejects[0]).toMatchObject({ tool: "speak", chars: 22 });
  });

  it("clamps fontSize and truncates long labels", () => {
    const c = collect();
    const p = events.createToolEventParser(c);
    for (const ch of toolChunks(
      0,
      "write_text",
      JSON.stringify({ content: "x".repeat(80), fontSize: 200 }),
    )) {
      p.feed(ch);
    }
    expect(c.out[0]).toMatchObject({ type: "canvas_text", fontSize: 36 });
    expect((c.out[0].content as string).length).toBe(60);
  });

  it("counts prose written outside tools instead of emitting it", () => {
    let chars = 0;
    const c = collect();
    const p = events.createToolEventParser({
      ...c,
      onText: (n: number) => (chars += n),
    });
    // The tools parser still consumes raw provider chunks; only the JSON
    // parser takes normalized text.
    for (const ch of textChunks("Let me explain the heart.")) {
      p.feed(ch);
    }
    expect(c.out).toEqual([]);
    expect(chars).toBe("Let me explain the heart.".length);
  });

  it("ignores thinking blocks and message-level events", () => {
    const c = collect();
    const p = events.createToolEventParser(c);
    expect(
      p.feed({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      }),
    ).toBe(false);
    expect(
      p.feed({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "hmm" },
      }),
    ).toBe(false);
    expect(p.feed({ type: "message_start", message: {} })).toBe(false);
    expect(p.feed({ type: "content_block_stop", index: 0 })).toBe(false);
    expect(c.out).toEqual([]);
  });
});

describe("json-mode parser (ADR-003 scanner)", () => {
  it("produces the same normalized events as tools mode for equivalent output", () => {
    const c = collect();
    const p = events.createJsonEventParser(c);
    const text = [
      JSON.stringify({
        type: "voice",
        text: "The heart pumps 2,000 gallons a day.",
      }),
      JSON.stringify({
        type: "canvas_text",
        content: "Left Ventricle",
        fontSize: 18,
      }),
      JSON.stringify({
        type: "visual_prompt",
        prompt: "Cross-section of a human heart",
        style: "photorealistic",
      }),
      JSON.stringify({
        type: "next_topic",
        suggestion: "Blood Pressure",
        prompt: "How does blood pressure work?",
      }),
      JSON.stringify({ type: "done" }),
    ].join("\n");
    for (const ch of textChunks(text, 7)) {
      p.feed(ch.delta.text);
    }
    p.flush();
    expect(c.rejects).toEqual([]);
    expect(c.out).toEqual([
      { type: "voice", text: "The heart pumps 2,000 gallons a day." },
      {
        type: "canvas_text",
        content: "Left Ventricle",
        x: 100,
        y: 100,
        fontSize: 18,
      },
      {
        type: "visual_prompt",
        prompt: "Cross-section of a human heart",
        style: "photorealistic",
      },
      {
        type: "next_topic",
        suggestion: "Blood Pressure",
        prompt: "How does blood pressure work?",
      },
    ]);
  });

  it("survives unbalanced braces inside strings (the ADR-003 regression)", () => {
    const c = collect();
    const p = events.createJsonEventParser(c);
    const text = JSON.stringify({
      type: "voice",
      text: "Type } to close the block, or { to open one.",
    });
    for (const ch of textChunks(text, 5)) {
      p.feed(ch.delta.text);
    }
    p.flush();
    expect(c.out).toHaveLength(1);
    expect(c.out[0]).toMatchObject({ type: "voice" });
  });

  it("reports a complete-but-invalid object as a reject", () => {
    const c = collect();
    const p = events.createJsonEventParser(c);
    for (const ch of textChunks('{"type": "voice", "text": tru}', 2)) {
      p.feed(ch.delta.text);
    }
    p.flush();
    expect(c.out).toEqual([]);
    expect(c.rejects[0]).toMatchObject({ reason: "invalid_json" });
  });
});

describe("system prompt", () => {
  it("is static per mode and only differs in the output-format section", () => {
    const json = systemPromptFor("json");
    const tools = systemPromptFor("tools");
    expect(systemPromptFor("json")).toBe(json); // memoized, byte-identical
    expect(json).toContain('{ "type": "done" }');
    expect(tools).not.toContain('{ "type": "done" }');
    expect(tools).toContain("speak(text)");
    // Nothing request-specific may leak into the cache prefix.
    for (const p of [json, tools]) {
      expect(p).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(p).toContain('NEVER say "I see you drew"');
    }
  });

  it("lists every tool the tools-mode prompt refers to", () => {
    const names = events.TOOLS.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      "draw_image",
      "speak",
      "suggest_next",
      "write_text",
    ]);
    for (const t of events.TOOLS) {
      expect(t.strict).toBe(true);
      expect(t.input_schema.additionalProperties).toBe(false);
    }
  });
});
