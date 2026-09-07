/**
 * Turn completion report (docs/18 Phase 2.3, the `turn_complete` event).
 *
 * A teaching turn spans several HTTP requests across three providers, and
 * only the browser knows when it ended and how. The client POSTs a small
 * summary here when startTeaching() finishes; we log it under the same
 * turnId as every provider call in that turn and count the outcome.
 *
 * Cost per turn is not summed here — the per-call `llm_call` events carry
 * cost_usd and share the turnId, so a log query does the aggregation.
 */

const metrics = require("../lib/metrics");

const OUTCOMES = new Set(["done", "error", "aborted"]);
const DROP_REASONS = new Set(["full", "circuit", "closed"]);

const int = (v, max = 10_000) =>
  Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : 0;

module.exports = (req, res) => {
  const b = req.body || {};
  const outcome = OUTCOMES.has(b.outcome) ? b.outcome : "error";
  const workers = b.workers && typeof b.workers === "object" ? b.workers : {};
  const dropped = workers.droppedByReason && typeof workers.droppedByReason === "object"
    ? workers.droppedByReason
    : {};

  metrics.turnsTotal.inc({ outcome });
  for (const [reason, n] of Object.entries(dropped)) {
    if (DROP_REASONS.has(reason) && int(n) > 0) {
      metrics.workerDropped.inc({ reason }, int(n));
    }
  }

  req.log.info(
    {
      event: "turn_complete",
      outcome,
      duration_ms: int(b.durationMs, 3_600_000),
      fast_path: !!b.fastPath,
      recognition_id: typeof b.recognitionId === "string" ? b.recognitionId.slice(0, 64) : null,
      voice_sentences: int(b.voiceSentences),
      canvas_texts: int(b.canvasTexts),
      images_requested: int(b.imagesRequested),
      images_placed: int(workers.completed),
      images_failed: int(workers.failed),
      images_dropped: int(workers.dropped),
      error: typeof b.error === "string" ? b.error.slice(0, 200) : null,
    },
    "teaching turn complete",
  );

  res.status(204).end();
};
