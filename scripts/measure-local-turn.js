/**
 * Measure one real teaching turn against whichever provider is configured.
 *
 *   node scripts/measure-local-turn.js [--port 3001] [--shape house]
 *
 * This is docs/18 Phase 0.5 — "the most valuable hour in this entire
 * document" — reduced to something repeatable. It draws a simple shape,
 * sends it through /api/ai/recognize, then runs /api/ai/master and times
 * both, reporting time-to-first-voice-event (what the student actually
 * waits for) rather than total wall clock.
 *
 * It measures latency and whether the pipeline works end to end. It does NOT
 * judge teaching quality — that needs a person looking at the canvas.
 */

const sharp = require("sharp");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const PORT = arg("port", process.env.AI_SERVER_PORT || "3001");
const BASE = `http://localhost:${PORT}`;
const SHAPE = arg("shape", "house");

/** Crude hand-drawn-looking shapes, the kind a student actually sketches. */
const SHAPES = {
  house: `<path d="M60 170 L60 95 L120 45 L180 95 L180 170 Z" fill="none" stroke="#111" stroke-width="5"/>
          <rect x="100" y="120" width="40" height="50" fill="none" stroke="#111" stroke-width="5"/>`,
  triangle: `<path d="M120 40 L195 175 L45 175 Z" fill="none" stroke="#111" stroke-width="6"/>`,
  heart: `<path d="M120 170 C40 110 60 40 120 80 C180 40 200 110 120 170 Z" fill="none" stroke="#111" stroke-width="6"/>`,
  sun: `<circle cx="120" cy="110" r="45" fill="none" stroke="#111" stroke-width="5"/>
        <path d="M120 40 L120 20 M120 200 L120 180 M50 110 L30 110 M210 110 L190 110" stroke="#111" stroke-width="5"/>`,
};

async function drawing(shape) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="220">
    <rect width="240" height="220" fill="#fff"/>${SHAPES[shape] || SHAPES.house}</svg>`;
  const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  return jpeg.toString("base64");
}

const ms = (t) => `${((Date.now() - t) / 1000).toFixed(1)}s`;

async function main() {
  const ready = await fetch(`${BASE}/readyz`).then((r) => r.json()).catch(() => null);
  if (!ready) {
    console.error(`Cannot reach the backend at ${BASE}. Start it with: corepack yarn start:server`);
    process.exit(1);
  }
  const brain = ready.providers?.teachingBrain || {};
  console.log(`provider : ${brain.provider || "?"}${brain.model ? ` (${brain.model})` : ""}`);
  if (!brain.ok) {
    console.error(`teaching brain not ready: ${brain.reason}${brain.hint ? `\n  try: ${brain.hint}` : ""}`);
    process.exit(1);
  }

  const canvasImage = await drawing(SHAPE);
  console.log(`drawing  : ${SHAPE} (${Math.round(canvasImage.length / 1024)} KB base64)\n`);

  // --- recognition -------------------------------------------------------
  const t0 = Date.now();
  const brief = await fetch(`${BASE}/api/ai/recognize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-turn-id": `measure-${Date.now()}` },
    body: JSON.stringify({ canvasImage }),
  }).then((r) => r.json());
  console.log(`recognize: ${ms(t0)}`);
  console.log(`  topic      : ${brief.topic || "(none)"}`);
  console.log(`  confidence : ${brief.confidence}`);
  console.log(`  visuals    : ${brief.visualBriefs?.length ?? 0}   labels: ${brief.canvasLabels?.length ?? 0}`);
  if (brief.voiceIntro) console.log(`  intro      : "${brief.voiceIntro.slice(0, 90)}"`);

  // --- teaching turn -----------------------------------------------------
  const t1 = Date.now();
  let firstEvent = null;
  const counts = {};
  const res = await fetch(`${BASE}/api/ai/master`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-turn-id": `measure-${Date.now()}` },
    body: JSON.stringify({
      message: brief.topic || "The student drew something on the canvas.",
      canvasImage,
      teachingBrief: brief.topic ? { ...brief, visualsAlreadyDispatched: false } : undefined,
    }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split("\n\n");
    buf = blocks.pop() ?? "";
    for (const b of blocks) {
      const m = b.match(/^data:\s*(.+)/);
      if (!m) continue;
      let ev;
      try {
        ev = JSON.parse(m[1]);
      } catch {
        continue;
      }
      counts[ev.type] = (counts[ev.type] || 0) + 1;
      if (!firstEvent && (ev.type === "voice" || ev.type === "error")) {
        firstEvent = { type: ev.type, at: Date.now() - t1, text: ev.text || ev.message };
      }
    }
  }

  console.log(`\nmaster   : ${ms(t1)} total`);
  if (firstEvent) {
    console.log(`  first ${firstEvent.type} after ${(firstEvent.at / 1000).toFixed(1)}s  <- what the student waits for`);
    console.log(`  "${String(firstEvent.text).slice(0, 100)}"`);
  } else {
    console.log("  no voice or error event arrived");
  }
  console.log(`  events     : ${JSON.stringify(counts)}`);

  const total = (Date.now() - t0) / 1000;
  console.log(`\ntotal turn : ${total.toFixed(1)}s`);
  console.log(
    total <= 10
      ? "verdict    : usable — a student will tolerate this"
      : "verdict    : too slow for a 3s debounce; see docs/07 for the free-tier fallback",
  );
}

main().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
