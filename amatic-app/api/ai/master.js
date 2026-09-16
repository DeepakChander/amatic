/**
 * Master Brain Endpoint
 * The "Conductor" of the Amatic AI experience.
 * 
 * Capabilities:
 * 1. Receives Canvas Context + User Query
 * 2. Streams Multi-Modal Response (Voice, Visuals, Text) via SSE
 * 3. Handles Interrupts
 */

const { TEACHING_MODEL } = require("./models");
const { anthropicFor, budgetFor } = require("../lib/providers");
const { recordLlmCall } = require("../lib/cost");
const metrics = require("../lib/metrics");
const {
    resolveMode,
    TOOLS,
    createToolEventParser,
    createJsonEventParser,
} = require("../lib/master-events");
const { systemPromptFor } = require("../lib/master-prompt");

// ---------------------------------------------------------------------------
// Lightweight content-type classifier (inline, no dependencies)
// Based on lib/ai/content-type-classifier.ts — determines optimal text/visual ratio
// ---------------------------------------------------------------------------
const CONTENT_PATTERNS_JS = {
  mathematical: ["equation","formula","proof","theorem","calculate","solve","integral","derivative","algebra","geometry","calculus","matrix","vector","polynomial","pythagorean","quadratic","logarithm"],
  scientific:   ["theory of","relativity","quantum","evolution","gravity","thermodynamics","big bang","plate tectonics","electromagnetic","molecular","genetic","entropy","nucleus","photosynthesis","dna"],
  philosophical:["philosophy","ethics","moral","kant","aristotle","plato","existential","utilitarianism","virtue","epistemology","metaphysics","consciousness"],
  historical:   ["history","ancient","century","war","empire","civilization","revolution","colonialism","dynasty","medieval","renaissance","industrial"],
  technical:    ["code","algorithm","programming","function","variable","loop","class","object","api","database","server","javascript","python","software"],
};
// text ratio = fraction of content that should be canvas_text (rest = voice + visual_prompt)
const RATIO_MAP = { mathematical: 0.40, scientific: 0.30, philosophical: 0.35, historical: 0.25, technical: 0.45, simple: 0.12 };

function classifyMessage(msg) {
  const lower = (msg || "").toLowerCase();
  let best = "simple", bestScore = 0;
  for (const [type, keywords] of Object.entries(CONTENT_PATTERNS_JS)) {
    const score = keywords.filter(k => lower.includes(k)).length;
    if (score > bestScore) { bestScore = score; best = type; }
  }
  const textRatio = RATIO_MAP[best] ?? 0.12;
  const visualRatio = 1 - textRatio;
  return { type: best, textRatio, visualRatio, requiresEquations: best === "mathematical" || best === "technical" };
}

module.exports = async (req, res) => {
    // Validate HTTP method
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    // Set up SSE headers for streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const log = req.log;
    // Set by the res 'close' handler and the idle watchdog below. Both are
    // declared at function scope so the outer catch can tell an interrupt
    // from a real provider error.
    let aborted = false;
    let stalled = false;
    // Usage summed across every model round of this turn: input tokens
    // arrive on message_start, output tokens on the final message_delta.
    const usage = {};
    const callStarted = Date.now();
    let callRecorded = false;
    const recordCall = (outcome, error) => {
        if (callRecorded) return;
        callRecorded = true;
        recordLlmCall(log, {
            route: "master",
            model: TEACHING_MODEL,
            usage: Object.keys(usage).length ? usage : null,
            latencyMs: Date.now() - callStarted,
            outcome,
            error,
        });
    };
    // Usage fields on message_start / message_delta are `number | null` and
    // null means "not applicable here", so never let a null overwrite a
    // value already captured — the SDK's own accumulator guards the same way.
    const mergeUsage = (target, u) => {
        for (const [k, v] of Object.entries(u || {})) {
            if (v != null) target[k] = v;
        }
    };

    try {
        const {
            message: rawMessage,
            canvasContext,
            userIntent,
            pointedElement,
            voiceTranscript,
            memoryContext,
            canvasImage,      // base64 JPEG of canvas — enables Claude vision
            teachingBrief,    // pre-built brief from /api/ai/recognize fast path
        } = req.body || {};

        // Extract enriched context fields (added by canvas-monitor upgrade)
        const toolInfo = canvasContext?.toolInfo;
        const canvasZones = canvasContext?.canvasZones;
        const viewport = canvasContext?.viewport;
        const elementStats = canvasContext?.elementStats;
        const message = typeof rawMessage === "string" ? rawMessage.trim() : "";

        // Validate message
        if (!message) {
            res.write(`data: ${JSON.stringify({ type: "error", message: "Valid message required" })}\n\n`);
            return res.end();
        }
        if (message.length > 10000) {
            res.write(`data: ${JSON.stringify({ type: "error", message: "Message too long (max 10,000 characters)" })}\n\n`);
            return res.end();
        }

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            res.write(`data: ${JSON.stringify({ type: "error", message: "API Key missing" })}\n\n`);
            return res.end();
        }

        // 30 s to first byte, 1 retry on the initial request only (Phase 1.3).
        const client = anthropicFor("master", apiKey);

        // Client disconnect. NOTE: this must be `res`, not `req` — on Node ≥16
        // the request emits 'close' as soon as its body has been consumed
        // (body-parser already did that), so a `req.on('close')` registered
        // here never fires for a real mid-stream disconnect. `res` 'close'
        // fires when the connection drops before the response ended.
        // Registered *before* the provider call so a disconnect during the
        // initial request cancels it too.
        const upstream = new AbortController();
        res.on("close", () => {
            if (res.writableEnded) return;
            aborted = true;
            log.info({ event: "client_disconnect" }, "client disconnected, aborting stream");
            upstream.abort();
        });

        // 1. Amatic AI system prompt: canvas-first teaching, full spatial + tool
        // awareness. Lives in api/lib/master-prompt.js because it is the
        // prompt-cache prefix (Phase 3.1) — static per output mode, nothing
        // request-specific in it.
        const mode = resolveMode();
        const systemPrompt = systemPromptFor(mode);

        // Build a focused, readable user prompt from enriched context
        const toolLine = toolInfo
            ? `ACTIVE TOOL: ${toolInfo.activeTool}${toolInfo.toolLocked ? " (locked)" : ""}${toolInfo.penMode ? " [pen mode]" : ""}\nTOOL CONTEXT: ${toolInfo.recentToolUsage}`
            : "";

        const zoneLine = canvasZones
            ? `CANVAS ZONES:\n${canvasZones.summary}`
            : "";

        const viewportLine = viewport
            ? `VIEWPORT: ${viewport.width}×${viewport.height}px, zoom: ${Math.round(viewport.zoom * 100)}%, scroll: (${viewport.scrollX}, ${viewport.scrollY})`
            : "";

        const statsLine = elementStats
            ? `CANVAS STATS: ${elementStats.total} elements total (${elementStats.userCount} user, ${elementStats.aiCount} AI). Types: ${Object.entries(elementStats.byType).map(([t, n]) => `${n} ${t}`).join(", ")}`
            : "";

        // Send elements summary (truncated to avoid hitting token limits)
        const elements = canvasContext?.elements ?? [];
        const userElements = elements.filter(e => e.creator === "user");
        const aiElements = elements.filter(e => e.creator === "ai");
        const elementsSummary = [
            userElements.length > 0
                ? `USER ELEMENTS:\n${userElements.slice(0, 30).map(e => `  [${e.id.slice(0,8)}] ${e.type}${e.content ? ': "' + String(e.content).slice(0,60) + '"' : ""}${e.style ? " (" + e.style + ")" : ""} at (${e.position.x}, ${e.position.y})`).join("\n")}`
                : "USER ELEMENTS: (none)",
            aiElements.length > 0
                ? `AI ELEMENTS ALREADY ON CANVAS:\n${aiElements.slice(0, 20).map(e => `  [${e.id.slice(0,8)}] ${e.type}${e.content ? ': "' + String(e.content).slice(0,60) + '"' : ""} at (${e.position.x}, ${e.position.y})`).join("\n")}`
                : "",
        ].filter(Boolean).join("\n");

        const recentChanges = canvasContext?.changes ?? [];
        const changesLine = recentChanges.length > 0
            ? `RECENT CHANGES:\n${recentChanges.slice(-5).map(c => `  ${c.type}: ${c.details}`).join("\n")}`
            : "";

        // Classify the message to determine optimal content ratios
        const classification = classifyMessage(message);
        const classificationLine = `CONTENT TYPE: ${classification.type} — recommended ratios: `
          + `${Math.round(classification.visualRatio * 100)}% visual_prompt, `
          + `${Math.round(classification.textRatio * 100)}% canvas_text`
          + (classification.requiresEquations ? ". This topic requires equations/formulas — prioritize canvas_text for those." : ".");

        // Build teaching brief section (highest priority — goes at the top)
        const briefLine = teachingBrief
            ? [
                `TEACHING BRIEF (pre-analyzed by vision AI):`,
                `Topic: ${teachingBrief.topic} (confidence: ${teachingBrief.confidence})`,
                teachingBrief.visualsAlreadyDispatched
                    ? `STATUS: Gemini workers already dispatched with expert prompts. DO NOT emit visual_prompt events. Focus ONLY on voice narration and canvas_text labels.`
                    : `STATUS: No visuals dispatched yet. You should generate visual_prompt events.`,
                teachingBrief.canvasLabels?.length > 0
                    ? `Suggested canvas labels: ${teachingBrief.canvasLabels.map(l => `"${l.content}"`).join(", ")}`
                    : "",
                teachingBrief.voiceIntro
                    ? `Suggested voice opener (use or improve): "${teachingBrief.voiceIntro}"`
                    : "",
              ].filter(Boolean).join("\n")
            : "";

        const userPrompt = [
            briefLine,
            classificationLine,
            toolLine,
            zoneLine,
            viewportLine,
            statsLine,
            elementsSummary,
            changesLine,
            `USER INTENT: ${userIntent}`,
            `USER MESSAGE: "${message}"`,
            pointedElement ? `POINTED ELEMENT (selected/hovered): ${pointedElement}` : "",
            voiceTranscript ? `VOICE TRANSCRIPT: "${voiceTranscript}"` : "",
            memoryContext ? `MEMORY (previous teaching this session):\n${memoryContext}` : "",
        ].filter(Boolean).join("\n\n");

        // 2. Build multimodal message content
        // If a canvas image was provided, Claude sees the actual drawing
        const userContent = [];
        if (canvasImage && typeof canvasImage === "string" && canvasImage.length > 0) {
            userContent.push({
                type: "image",
                source: {
                    type: "base64",
                    media_type: "image/jpeg",
                    data: canvasImage,
                },
            });
        }
        userContent.push({ type: "text", text: userPrompt });

        // 3. Stream the turn.
        // TEACHING_MODEL has a 1M-token input context window as standard, so no
        // beta header is needed for the canvas state + memory to fit.
        // max_tokens caps OUTPUT only; the model's ceiling is 128K.
        const request = {
            model: TEACHING_MODEL,
            max_tokens: 64000, // room for thinking + a full teaching turn; ceiling is 128K
            // Sonnet 5 rejects non-default temperature/top_p/top_k with a 400,
            // so the previous temperature: 0.7 is gone — steer tone via the prompt.
            thinking: { type: "adaptive" },
            // Sonnet 5 at "medium" is comparable to Sonnet 4.6 at "high", so this
            // holds prior teaching quality while limiting the thinking latency a
            // student now waits through. Raise to "high"/"xhigh" for richer turns.
            output_config: { effort: "medium" },
            // Phase 3.1 — prompt caching. Render order is tools → system →
            // messages and caching is a prefix match, so the frozen system
            // prompt (and, in tools mode, the fixed tool list before it) is the
            // cached prefix; everything volatile — canvas state, image, memory,
            // brief — sits in the user message after the breakpoint. Verify with
            // usage.cache_read_input_tokens on the llm_call event: if it stays
            // 0 across turns, either something in the prefix varies or the
            // prefix is under this model's 1024-token minimum.
            system: [
                { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
            ],
            messages: [{ role: "user", content: userContent }],
        };
        if (mode === "tools") {
            request.tools = TOOLS;
        }

        // Mid-stream watchdog: a provider that stops sending deltas must not
        // hold the turn open forever. Never retried — once bytes are on the
        // wire the turn is non-idempotent; the student's next draw starts a
        // fresh one. Thinking deltas count as activity, so a long think does
        // not trip it.
        const STREAM_IDLE_MS = budgetFor("master").idleMs;
        let idleTimer = null;
        const armIdleTimer = () => {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                stalled = true;
                log.warn({ event: "stream_stalled", idle_ms: STREAM_IDLE_MS }, "no delta, aborting stream");
                upstream.abort();
            }, STREAM_IDLE_MS);
        };

        // 4. Turn model output into typed SSE events. Both parsers emit the
        // same normalized shapes (api/lib/master-events.js).
        const eventsByType = {};
        let proseChars = 0;
        const emit = (event) => {
            eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
            metrics.masterEvents.inc({ mode, type: event.type });
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        const reject = (info) => {
            // Complete but invalid: surface it instead of dropping student-
            // facing content silently. Only sizes are logged — the content may
            // be student-facing text.
            metrics.parserRejects.inc();
            log.warn({ event: "parser_reject", mode, ...info }, "discarded invalid model output");
        };
        const parser = mode === "tools"
            ? createToolEventParser({ onEvent: emit, onReject: reject, onText: (n) => { proseChars += n; } })
            : createJsonEventParser({ onEvent: emit, onReject: reject });

        // In tools mode one model turn may span several rounds: the model
        // calls tools, we acknowledge them, it continues. Every round's usage
        // is billed, so rounds are summed into `usage`.
        const MAX_TOOL_ROUNDS = 6;
        let rounds = 0;
        let stopReason = null;
        const addUsage = (u) => {
            for (const [k, v] of Object.entries(u || {})) {
                if (typeof v === "number") usage[k] = (usage[k] || 0) + v;
            }
        };

        armIdleTimer();
        try {
            for (;;) {
                rounds++;
                metrics.masterRounds.inc({ mode });
                const stream = client.messages.stream(request, { signal: upstream.signal });
                // Usage as seen on the wire for this round, in case the round is
                // cut short and finalMessage() never resolves.
                const roundUsage = {};
                let final = null;
                try {
                    for await (const chunk of stream) {
                        if (aborted) break;
                        armIdleTimer();
                        if (chunk.type === "message_start" && chunk.message?.usage) {
                            mergeUsage(roundUsage, chunk.message.usage);
                        } else if (chunk.type === "message_delta") {
                            if (chunk.usage) mergeUsage(roundUsage, chunk.usage);
                            if (chunk.delta?.stop_reason) stopReason = chunk.delta.stop_reason;
                        } else {
                            parser.feed(chunk);
                        }
                    }
                    // Inside the guarded block on purpose: an abort landing
                    // between the last chunk and here rejects finalMessage(),
                    // and that is an interrupt, not a provider failure.
                    if (!aborted && !stalled) final = await stream.finalMessage();
                } catch (err) {
                    // The SDK throws on our own abort; that is not a failure.
                    if (!(aborted || stalled)) throw err;
                }
                if (aborted || stalled) {
                    // The round was cut short, but its tokens were still
                    // billed — count what came over the wire.
                    addUsage(roundUsage);
                    break;
                }
                addUsage(final.usage);
                stopReason = final.stop_reason;
                if (mode !== "tools" || stopReason !== "tool_use") break;
                if (rounds >= MAX_TOOL_ROUNDS) {
                    log.warn({ event: "tool_rounds_exhausted", rounds }, "model kept calling tools; ending turn");
                    break;
                }
                // Acknowledge every call in ONE user message (splitting them
                // teaches the model to stop calling tools in parallel) and let
                // the model continue. Thinking blocks go back unchanged.
                const toolUses = final.content.filter((b) => b.type === "tool_use");
                request.messages.push({ role: "assistant", content: final.content });
                request.messages.push({
                    role: "user",
                    content: toolUses.map((t) => ({ type: "tool_result", tool_use_id: t.id, content: "ok" })),
                });
            }
        } finally {
            if (idleTimer) clearTimeout(idleTimer);
        }
        if (parser.flush) parser.flush();

        log.info(
            {
                event: "master_stream_complete",
                mode,
                rounds,
                stop_reason: stopReason,
                events: eventsByType,
                prose_chars: proseChars,
                tool_calls: parser.toolCalls ?? null,
            },
            "master stream complete",
        );

        if (stalled) {
            recordCall("aborted", new Error("stream stalled"));
        } else if (aborted) {
            recordCall("aborted", new Error("client disconnected"));
        } else {
            recordCall("ok");
        }

        // 5. Finish. The SDK's iterator returns quietly (no throw) when its
        // controller is aborted, so a stalled turn must be reported here or
        // the client would see a clean `done` for a lesson that died.
        if (aborted) {
            return res.end();
        }
        if (stalled) {
            res.write(`data: ${JSON.stringify({ type: "error", message: "The tutor stopped responding." })}\n\n`);
            return res.end();
        }
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        res.end();

    } catch (error) {
        // `stalled` is checked too: the watchdog aborts the upstream request,
        // and that rejection must not be filed as a provider error.
        recordCall(aborted || stalled ? "aborted" : "error", error);
        if (res.writableEnded) return;
        log.error({ err: error, event: "master_error", status: error?.status ?? null }, "master turn failed");
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            message:
              process.env.NODE_ENV === "production"
                ? "An error occurred"
                : error.message,
          })}\n\n`,
        );
        res.end();
    }
};
