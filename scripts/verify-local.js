/**
 * One command that checks whether the fully-local stack is actually working.
 *
 *   node scripts/verify-local.js
 *
 * Runs every capability the teaching loop depends on, in the order a real
 * turn uses them, and prints PASS/FAIL with the number that matters. Exits
 * non-zero if anything a student would notice is broken.
 *
 * It exercises the real endpoints over HTTP — no mocks — so a pass here means
 * the same code paths the browser uses are working.
 */

const PORT = process.env.AI_SERVER_PORT || 3001;
const BASE = `http://localhost:${PORT}`;
const OLLAMA = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "");

let failures = 0;
let warnings = 0;

const pad = (s, n) => String(s).padEnd(n);
const secs = (t) => `${((Date.now() - t) / 1000).toFixed(1)}s`;

function pass(name, detail = "") {
  console.log(`  \x1b[32mPASS\x1b[0m  ${pad(name, 34)} ${detail}`);
}
function fail(name, detail = "", fix = "") {
  failures++;
  console.log(`  \x1b[31mFAIL\x1b[0m  ${pad(name, 34)} ${detail}`);
  if (fix) console.log(`        ${"".padEnd(34)} fix: ${fix}`);
}
function warn(name, detail = "") {
  warnings++;
  console.log(`  \x1b[33mWARN\x1b[0m  ${pad(name, 34)} ${detail}`);
}

const get = (url, ms = 30000) =>
  fetch(url, { signal: AbortSignal.timeout(ms) }).catch((e) => ({ ok: false, err: e.message }));

const post = (url, body, ms = 180000) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  }).catch((e) => ({ ok: false, err: e.message }));

async function main() {
  console.log("\nAmatic local stack check\n");

  // -- 1. Ollama ----------------------------------------------------------
  console.log("Reasoning (Ollama)");
  const tags = await get(`${OLLAMA}/api/tags`, 8000);
  if (!tags.ok) {
    fail("ollama reachable", tags.err || `HTTP ${tags.status}`, "docker compose -f docker-compose.ollama.yml up -d");
  } else {
    const models = (await tags.json()).models || [];
    pass("ollama reachable", `${models.length} model(s)`);
    if (!models.length) {
      fail("model pulled", "none", "docker compose -f docker-compose.ollama.yml exec ollama ollama pull qwen2.5vl:3b");
    } else {
      pass("model pulled", models.map((m) => m.name).join(", "));
    }
  }

  // -- 2. Backend ---------------------------------------------------------
  console.log("\nBackend");
  const live = await get(`${BASE}/healthz`, 5000);
  if (!live.ok) {
    fail("backend up", live.err || `HTTP ${live.status}`, "corepack yarn start");
    return done();
  }
  pass("backend up", `${BASE}`);

  const readyRes = await get(`${BASE}/readyz`, 40000);
  const ready = readyRes.ok || readyRes.status === 503 ? await readyRes.json() : null;
  if (!ready) {
    fail("readiness", "no response");
  } else {
    for (const [cap, p] of Object.entries(ready.providers || {})) {
      const detail = `${p.provider || "?"}${p.model ? ` (${p.model})` : ""}`;
      if (p.ok) pass(cap, detail);
      else fail(cap, `${detail} — ${p.reason || "not ok"}`, p.hint || "");
    }
  }

  // -- 3. Recognition -----------------------------------------------------
  console.log("\nDrawing recognition");
  const t0 = Date.now();
  const rec = await post(`${BASE}/api/ai/recognize`, { canvasImage: "/9j/4AAQSkZJRg==" }, 60000);
  if (!rec.ok) {
    fail("recognize responds", rec.err || `HTTP ${rec.status}`);
  } else {
    const b = await rec.json();
    const took = secs(t0);
    if (b.topic) pass("recognize", `"${b.topic}" (${b.confidence}) in ${took}`);
    else warn("recognize", `no topic — vision is off on this provider (${took}). The tutor teaches from canvas context instead.`);
  }

  // -- 4. Teaching turn ---------------------------------------------------
  console.log("\nTeaching turn");
  const t1 = Date.now();
  const res = await post(
    `${BASE}/api/ai/master`,
    {
      message: "The student drew the water cycle.",
      userIntent: "drawing the water cycle",
      canvasContext: {
        elementStats: { total: 3, userCount: 3, aiCount: 0, byType: { freedraw: 3 } },
        toolInfo: { activeTool: "freedraw", recentToolUsage: "drawing" },
      },
    },
    180000,
  );
  if (!res.ok || !res.body) {
    fail("master responds", res.err || `HTTP ${res.status}`);
  } else {
    const counts = {};
    let firstVoice = null;
    let errText = null;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const p of parts) {
        const m = p.match(/^data:\s*(.+)/);
        if (!m) continue;
        let ev;
        try {
          ev = JSON.parse(m[1]);
        } catch {
          continue;
        }
        counts[ev.type] = (counts[ev.type] || 0) + 1;
        if (ev.type === "voice" && !firstVoice) firstVoice = { at: Date.now() - t1, text: ev.text };
        if (ev.type === "error") errText = ev.message;
      }
    }
    if (errText) fail("teaching turn", errText);
    else if (!counts.voice) fail("narration produced", `events: ${JSON.stringify(counts)} — no voice event`);
    else {
      pass("teaching turn", `${secs(t1)}, events: ${JSON.stringify(counts)}`);
      pass("first narration", `${(firstVoice.at / 1000).toFixed(1)}s — "${firstVoice.text.slice(0, 60)}"`);
    }
  }

  // -- 5. Speech ----------------------------------------------------------
  console.log("\nSpeech (Kokoro)");
  // A natural sentence, varied by a short word rather than a timestamp:
  // Kokoro pronounces long numbers digit by digit, which added ~12s and made
  // this check report a synthesis time no real narration would ever hit.
  const nonce = ["quietly", "slowly", "steadily", "gently", "freely"][Math.floor(Date.now() / 1000) % 5];
  const line = `Water moves ${nonce} around our planet in a cycle.`;
  const t2 = Date.now();
  const tts = await post(`${BASE}/api/voice/text-to-speech`, { text: line }, 240000);
  if (!tts.ok) {
    fail("synthesis", tts.err || `HTTP ${tts.status}`);
  } else {
    const bytes = (await tts.arrayBuffer()).byteLength;
    const took = (Date.now() - t2) / 1000;
    pass("synthesis", `${took.toFixed(1)}s, ${Math.round(bytes / 1024)} KB, ${tts.headers.get("x-tts-provider")}`);
    // ~6s/sentence is the measured CPU baseline here. Playback starts on the
    // first sentence while later ones synthesise, so the cost the student
    // feels is roughly one sentence, not the whole turn.
    if (took > 12) warn("synthesis speed", `${took.toFixed(1)}s per sentence — first audio will lag badly`);
    else if (took > 8) warn("synthesis speed", `${took.toFixed(1)}s per sentence — slower than the ~6s baseline`);
    const t3 = Date.now();
    const again = await post(`${BASE}/api/voice/text-to-speech`, { text: line }, 60000);
    if (again.ok && again.headers.get("x-tts-cache") === "hit") {
      pass("speech cache", `${((Date.now() - t3) / 1000).toFixed(2)}s on repeat`);
    } else {
      warn("speech cache", "repeat was not served from cache");
    }
  }

  // -- 6. Images ----------------------------------------------------------
  console.log("\nImages (diagram library)");
  const hit = await post(`${BASE}/api/ai/worker`, { prompt: "diagram of the water cycle with evaporation" }, 60000);
  if (hit.status === 200) {
    const j = await hit.json();
    pass("library hit", `source=${j.source}, ${Math.round((j.imageData || "").length / 1024)} KB`);
  } else if (hit.status === 204) {
    fail("library hit", "no diagram matched a water-cycle request", "node scripts/build-diagram-library.js");
  } else {
    fail("library hit", hit.err || `HTTP ${hit.status}`);
  }
  const miss = await post(`${BASE}/api/ai/worker`, { prompt: "a medieval castle on a hill" }, 60000);
  if (miss.status === 204) pass("declines unknown topic", "204, no wrong picture served");
  else warn("declines unknown topic", `expected 204, got ${miss.status}`);

  done();
}

function done() {
  console.log("");
  if (failures) {
    console.log(`\x1b[31m${failures} check(s) failed\x1b[0m${warnings ? `, ${warnings} warning(s)` : ""}\n`);
    process.exit(1);
  }
  console.log(`\x1b[32mAll checks passed\x1b[0m${warnings ? ` with ${warnings} warning(s)` : ""} — open http://localhost:3000 and draw.\n`);
}

main().catch((e) => {
  console.error("verify failed:", e.message);
  process.exit(1);
});
