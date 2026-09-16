/**
 * Teaching-brain provider abstraction (docs/07 target architecture).
 *
 *   LLM_PROVIDER = gemini (default) | anthropic
 *
 * `gemini` runs the whole teaching loop on the Google AI Studio **free tier**
 * (Gemini 2.5 Flash): no card, ~1,500 requests/day. One turn costs 2 calls,
 * so that is roughly 125 turns — about 20 five-minute sessions a day. Enough
 * to develop, demo and run a small pilot; not a classroom. docs/07 does the
 * arithmetic.
 *
 * `anthropic` keeps the Claude path (better structured-output reliability,
 * prompt caching) for anyone who has a paid key. Both are kept so narration
 * quality can be compared rather than cut over blind — same reasoning as
 * TTS_PROVIDER in tts.js.
 *
 * Both backends normalize to one small interface so the routes do not branch:
 *
 *   stream(...)  -> async iterator of
 *                     { kind: "text",  text }         incremental prose
 *                     { kind: "tool",  name, input }  a complete tool call
 *                     { kind: "usage", usage }        normalized token counts
 *   generate(...) -> { text, usage }                  non-streaming
 *
 * Normalized usage keys match the Anthropic names already used by cost.js and
 * the llm_call log event: input_tokens, output_tokens,
 * cache_read_input_tokens, cache_creation_input_tokens.
 */

const { anthropicFor, geminiFor, budgetFor } = require("./providers");
const {
  TEACHING_MODEL,
  CHAT_MODEL,
  GEMINI_TEACHING_MODEL,
  GEMINI_CHAT_MODEL,
  OLLAMA_TEACHING_MODEL,
  OLLAMA_CHAT_MODEL,
} = require("../ai/models");

const PROVIDERS = new Set(["ollama", "gemini", "anthropic"]);

function resolveLlmProvider(raw = process.env.LLM_PROVIDER) {
  const p = String(raw || "ollama").toLowerCase();
  return PROVIDERS.has(p) ? p : "ollama";
}

const OLLAMA_URL = () => (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "");

/**
 * Can this provider look at the canvas image?
 *
 * Measured on the target machine (CPU only, no usable GPU): a 240x220 JPEG
 * costs ~1,090 vision tokens and **70 seconds** to encode, against a 3-second
 * debounce — while text generation on the same model runs at a perfectly
 * usable ~16 tokens/sec. So vision is off by default on the local provider:
 * the turn instead relies on the canvas element descriptions the client
 * already sends, which cost nothing extra.
 *
 * Set OLLAMA_VISION=1 to turn it back on if you have a GPU, and expect
 * recognition to work but each turn to take over a minute.
 */
function supportsVision(provider = resolveLlmProvider()) {
  if (provider !== "ollama") return true;
  return process.env.OLLAMA_VISION === "1";
}

/** The model id a route will actually call, for logging and cost attribution. */
function modelFor(route, provider = resolveLlmProvider()) {
  const teaching = route === "master" || route === "recognize";
  if (provider === "gemini") return teaching ? GEMINI_TEACHING_MODEL : GEMINI_CHAT_MODEL;
  if (provider === "ollama") return teaching ? OLLAMA_TEACHING_MODEL : OLLAMA_CHAT_MODEL;
  return teaching ? TEACHING_MODEL : CHAT_MODEL;
}

/** Which env key a provider needs, so routes can fail with a useful message. */
function apiKeyFor(provider = resolveLlmProvider()) {
  if (provider === "ollama") {
    // Local: nothing to authenticate. The sentinel keeps the routes' existing
    // "is it configured" check honest without inventing a fake key.
    return { key: "local", name: "OLLAMA_URL", local: true };
  }
  if (provider === "gemini") {
    return {
      key: process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY,
      name: "GOOGLE_AI_API_KEY",
    };
  }
  return { key: process.env.ANTHROPIC_API_KEY, name: "ANTHROPIC_API_KEY" };
}

// ---------------------------------------------------------------------------
// Anthropic backend
// ---------------------------------------------------------------------------

/** Copy only non-null usage fields — null means "not applicable", not zero. */
function mergeAnthropicUsage(target, u) {
  for (const [k, v] of Object.entries(u || {})) {
    if (v != null && typeof v === "number") target[k] = v;
  }
  return target;
}

/**
 * A turn may span several model rounds when tools are in play: the model
 * calls tools, we acknowledge them, it continues. Both providers stop and
 * wait for tool results, so the loop lives here rather than in the route.
 */
const MAX_TOOL_ROUNDS = 6;

async function* anthropicStream({ route, apiKey, system, userContent, tools, signal, maxTokens, effort, onRound }) {
  const client = anthropicFor(route, apiKey);
  const messages = [{ role: "user", content: userContent }];
  const total = {};

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
    onRound?.(round);
    const request = {
      model: modelFor(route, "anthropic"),
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort },
      // Prompt caching (docs/18 Phase 3.1): the frozen system prompt is the
      // cached prefix; everything volatile sits in the user message after it.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
    };
    if (tools) request.tools = tools;

    const stream = client.messages.stream(request, { signal });
    const open = new Map();
    const roundUsage = {};
    try {
      for await (const chunk of stream) {
        if (chunk.type === "message_start" && chunk.message?.usage) {
          mergeAnthropicUsage(roundUsage, chunk.message.usage);
        } else if (chunk.type === "message_delta") {
          if (chunk.usage) mergeAnthropicUsage(roundUsage, chunk.usage);
        } else if (chunk.type === "content_block_start" && chunk.content_block?.type === "tool_use") {
          open.set(chunk.index, { name: chunk.content_block.name, json: "" });
        } else if (chunk.type === "content_block_delta") {
          const d = chunk.delta;
          if (d?.type === "text_delta" && d.text) {
            yield { kind: "text", text: d.text };
          } else if (d?.type === "input_json_delta") {
            const t = open.get(chunk.index);
            if (t) t.json += d.partial_json || "";
          }
        } else if (chunk.type === "content_block_stop") {
          const t = open.get(chunk.index);
          if (t) {
            open.delete(chunk.index);
            // Always JSON.parse tool input — escaping differs between models.
            let input = null;
            let error;
            try {
              input = t.json.trim() ? JSON.parse(t.json) : {};
            } catch (err) {
              error = err.message;
            }
            yield { kind: "tool", name: t.name, input, error };
          }
        }
      }
    } finally {
      for (const [k, v] of Object.entries(roundUsage)) total[k] = (total[k] || 0) + v;
    }

    const final = await stream.finalMessage();
    if (!tools || final.stop_reason !== "tool_use") break;
    // Acknowledge every call in ONE user message — splitting them teaches the
    // model to stop calling tools in parallel.
    const calls = final.content.filter((b) => b.type === "tool_use");
    messages.push({ role: "assistant", content: final.content });
    messages.push({
      role: "user",
      content: calls.map((t) => ({ type: "tool_result", tool_use_id: t.id, content: "ok" })),
    });
  }
  yield { kind: "usage", usage: total };
}

async function anthropicGenerate({ route, apiKey, system, userContent, maxTokens, effort, signal, json }) {
  const client = anthropicFor(route, apiKey);
  const req = {
    model: modelFor(route, "anthropic"),
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    output_config: { effort },
    messages: [{ role: "user", content: userContent }],
  };
  if (system) {
    req.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  }
  if (json) req.output_config.format = { type: "json_schema", schema: json };
  const response = await client.messages.create(req, { signal });
  const text = response.content?.find((b) => b.type === "text")?.text ?? "";
  return { text, usage: mergeAnthropicUsage({}, response.usage), model: response.model };
}

// ---------------------------------------------------------------------------
// Gemini backend
// ---------------------------------------------------------------------------

const EFFORT_TO_THINKING = { low: 0, medium: 4096, high: 8192, xhigh: 16384, max: 24576 };

function geminiUsage(m) {
  if (!m) return {};
  const out = {};
  if (m.promptTokenCount != null) out.input_tokens = m.promptTokenCount;
  // Gemini reports thinking tokens separately; they are billed as output.
  const cand = m.candidatesTokenCount ?? 0;
  const thoughts = m.thoughtsTokenCount ?? 0;
  if (cand || thoughts) out.output_tokens = cand + thoughts;
  if (m.cachedContentTokenCount != null) out.cache_read_input_tokens = m.cachedContentTokenCount;
  return out;
}

/** Anthropic-style content blocks -> Gemini parts. */
function toGeminiParts(userContent) {
  const parts = [];
  for (const block of userContent) {
    if (block.type === "text") {
      parts.push({ text: block.text });
    } else if (block.type === "image") {
      parts.push({
        inlineData: { mimeType: block.source.media_type, data: block.source.data },
      });
    }
  }
  return parts;
}

/** Anthropic tool definitions -> Gemini function declarations. */
function toGeminiTools(tools) {
  if (!tools) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: t.input_schema,
      })),
    },
  ];
}

function geminiConfig({ system, tools, maxTokens, effort, signal, json }) {
  const config = {
    systemInstruction: system,
    maxOutputTokens: maxTokens,
    abortSignal: signal,
  };
  const budget = EFFORT_TO_THINKING[effort];
  if (budget != null) config.thinkingConfig = { thinkingBudget: budget };
  if (tools) {
    config.tools = toGeminiTools(tools);
  } else if (json) {
    // Structured output: the free-tier models are markedly more reliable with
    // a schema than with "return JSON" in the prompt.
    config.responseMimeType = "application/json";
    config.responseJsonSchema = json;
  }
  return config;
}

async function* geminiStream({ route, apiKey, system, userContent, tools, signal, maxTokens, effort, onRound }) {
  const ai = geminiFor(route, apiKey);
  const model = modelFor(route, "gemini");
  const contents = [{ role: "user", parts: toGeminiParts(userContent) }];
  const total = {};

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
    onRound?.(round);
    const stream = await ai.models.generateContentStream({
      model,
      contents,
      config: geminiConfig({ system, tools, maxTokens, effort, signal }),
    });

    const calls = [];
    const modelParts = [];
    for await (const chunk of stream) {
      // Gemini reports cumulative usage per chunk; the last one wins.
      if (chunk.usageMetadata) {
        const u = geminiUsage(chunk.usageMetadata);
        for (const [k, v] of Object.entries(u)) total[k] = v;
      }
      for (const part of chunk.candidates?.[0]?.content?.parts || []) {
        modelParts.push(part);
        if (part.functionCall) {
          // Gemini delivers function calls whole, already parsed.
          calls.push(part.functionCall);
          yield { kind: "tool", name: part.functionCall.name, input: part.functionCall.args || {} };
        } else if (part.text) {
          yield { kind: "text", text: part.text };
        }
      }
    }

    if (!tools || calls.length === 0) break;
    contents.push({ role: "model", parts: modelParts });
    contents.push({
      role: "user",
      parts: calls.map((c) => ({
        functionResponse: { name: c.name, response: { result: "ok" } },
      })),
    });
  }
  yield { kind: "usage", usage: total };
}

async function geminiGenerate({ route, apiKey, system, userContent, maxTokens, effort, signal, json }) {
  const ai = geminiFor(route, apiKey);
  const response = await ai.models.generateContent({
    model: modelFor(route, "gemini"),
    contents: [{ role: "user", parts: toGeminiParts(userContent) }],
    config: geminiConfig({ system, maxTokens, effort, signal, json }),
  });
  return { text: response.text ?? "", usage: geminiUsage(response.usageMetadata), model: modelFor(route, "gemini") };
}

// ---------------------------------------------------------------------------
// Ollama backend — fully local, no account, no network egress
// ---------------------------------------------------------------------------

/** Anthropic content blocks -> Ollama message (text + base64 images). */
function toOllamaMessage(userContent) {
  const text = [];
  const images = [];
  for (const block of userContent) {
    if (block.type === "text") text.push(block.text);
    else if (block.type === "image") images.push(block.source.data);
  }
  const msg = { role: "user", content: text.join("\n\n") };
  if (images.length) msg.images = images;
  return msg;
}

/** Anthropic tool definitions -> Ollama function tools. */
function toOllamaTools(tools) {
  if (!tools) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

function ollamaUsage(d) {
  const out = {};
  if (d?.prompt_eval_count != null) out.input_tokens = d.prompt_eval_count;
  if (d?.eval_count != null) out.output_tokens = d.eval_count;
  return out;
}

/** POST /api/chat and yield parsed NDJSON objects. */
async function* ollamaChat(body, signal) {
  let res;
  try {
    res = await fetch(`${OLLAMA_URL()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    // Surfaced to the student via the red status dot, so make it actionable.
    throw new Error(
      `Cannot reach the local AI at ${OLLAMA_URL()}. Start it with: docker compose -f docker-compose.ollama.yml up -d`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  if (!res.body) throw new Error("Ollama returned no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      try {
        yield JSON.parse(s);
      } catch {
        /* partial or keepalive line */
      }
    }
  }
  if (buf.trim()) {
    try {
      yield JSON.parse(buf);
    } catch {
      /* ignore trailing partial */
    }
  }
}

async function* ollamaStream({ route, system, userContent, tools, signal, maxTokens, onRound }) {
  const model = modelFor(route, "ollama");
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push(toOllamaMessage(userContent));
  const total = {};

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
    onRound?.(round);
    const body = {
      model,
      messages,
      stream: true,
      options: { num_predict: maxTokens },
    };
    const t = toOllamaTools(tools);
    if (t) body.tools = t;

    const calls = [];
    let assistantText = "";
    for await (const chunk of ollamaChat(body, signal)) {
      const msg = chunk.message;
      if (msg?.content) {
        assistantText += msg.content;
        yield { kind: "text", text: msg.content };
      }
      for (const call of msg?.tool_calls || []) {
        const fn = call.function || {};
        // Ollama may hand back arguments as an object or a JSON string.
        let input = fn.arguments;
        if (typeof input === "string") {
          try {
            input = JSON.parse(input);
          } catch (err) {
            yield { kind: "tool", name: fn.name, input: null, error: err.message };
            continue;
          }
        }
        calls.push({ name: fn.name, input: input || {} });
        yield { kind: "tool", name: fn.name, input: input || {} };
      }
      if (chunk.done) {
        for (const [k, v] of Object.entries(ollamaUsage(chunk))) total[k] = (total[k] || 0) + v;
      }
    }

    if (!tools || calls.length === 0) break;
    messages.push({ role: "assistant", content: assistantText, tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.input } })) });
    for (const c of calls) {
      messages.push({ role: "tool", content: "ok", tool_name: c.name });
    }
  }
  yield { kind: "usage", usage: total };
}

async function ollamaGenerate({ route, system, userContent, maxTokens, signal, json }) {
  const model = modelFor(route, "ollama");
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push(toOllamaMessage(userContent));
  const body = { model, messages, stream: false, options: { num_predict: maxTokens } };
  // A JSON schema markedly improves small local models' structured output.
  if (json) body.format = json;

  const res = await fetch(`${OLLAMA_URL()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return { text: data.message?.content ?? "", usage: ollamaUsage(data), model };
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

const BACKENDS = {
  anthropic: { stream: anthropicStream, generate: anthropicGenerate },
  gemini: { stream: geminiStream, generate: geminiGenerate },
  ollama: { stream: ollamaStream, generate: ollamaGenerate },
};

/**
 * Stream a turn. Yields normalized {kind:"text"|"tool"|"usage"} items.
 * `userContent` uses Anthropic content-block shape; the Gemini backend
 * translates it.
 */
function stream(opts) {
  const provider = opts.provider || resolveLlmProvider();
  return BACKENDS[provider].stream(opts);
}

/** One non-streaming call. Returns { text, usage, model }. */
function generate(opts) {
  const provider = opts.provider || resolveLlmProvider();
  return BACKENDS[provider].generate(opts);
}

/** Cheap readiness probe for whichever provider is active. */
async function probeLlm(provider = resolveLlmProvider()) {
  const { key, name } = apiKeyFor(provider);
  if (!key) return { configured: false, ok: false, provider, reason: `no ${name}` };
  const { timeoutMs } = budgetFor("probe");

  if (provider === "ollama") {
    const want = modelFor("master", "ollama");
    let res;
    try {
      res = await fetch(`${OLLAMA_URL()}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      // "fetch failed" on its own tells an operator nothing useful.
      return {
        configured: true,
        ok: false,
        provider,
        reason: `cannot reach Ollama at ${OLLAMA_URL()}`,
        hint: "docker compose -f docker-compose.ollama.yml up -d",
        err: err.message,
      };
    }
    if (!res.ok) {
      return { configured: true, ok: false, provider, reason: `Ollama HTTP ${res.status}`, url: OLLAMA_URL() };
    }
    const data = await res.json();
    const names = (data.models || []).map((m) => m.name);
    // Reachable but without the model pulled, the first turn fails — say so
    // here rather than at teaching time.
    const pulled = names.some((n) => n === want || n.split(":")[0] === want.split(":")[0]);
    return pulled
      ? { configured: true, ok: true, provider, model: want, url: OLLAMA_URL() }
      : {
          configured: true,
          ok: false,
          provider,
          reason: `model ${want} not pulled`,
          hint: `ollama pull ${want}`,
          available: names.slice(0, 10),
          url: OLLAMA_URL(),
        };
  }

  if (provider === "gemini") {
    const ai = geminiFor("probe", key);
    await ai.models.list({ config: { pageSize: 1, abortSignal: AbortSignal.timeout(timeoutMs) } });
  } else {
    await anthropicFor("probe", key).models.list({ limit: 1 });
  }
  return { configured: true, ok: true, provider, model: modelFor("master", provider) };
}

module.exports = {
  stream,
  generate,
  resolveLlmProvider,
  supportsVision,
  modelFor,
  apiKeyFor,
  probeLlm,
  toGeminiParts,
  toGeminiTools,
  geminiUsage,
};
