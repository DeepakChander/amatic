/**
 * Correlation IDs (docs/18 Phase 2.2).
 *
 * The client generates a turnId in startTeaching() and sends it as
 * `x-turn-id` on every request of that turn. This middleware reads it (or
 * mints one), attaches a child logger as `req.log`, echoes the id back in
 * the response header, and writes one `http_request` event per request with
 * latency and status.
 *
 * Ids from the wire are untrusted: anything that is not a short, plain token
 * is replaced rather than logged.
 */

const { randomUUID } = require("crypto");
const { log } = require("./logger");
const metrics = require("./metrics");

const TURN_ID_HEADER = "x-turn-id";
const TURN_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function sanitizeTurnId(raw) {
  if (typeof raw === "string" && TURN_ID_PATTERN.test(raw)) return raw;
  return randomUUID();
}

/**
 * Route label for metrics. Only a *matched* route path is used
 * ("/api/ai/worker/:id" — Express already keeps the placeholder). Anything
 * unmatched (404s, requests rejected before routing) gets one fixed label:
 * a raw client-supplied URL must never become a Prometheus label value or a
 * scanner can grow the registry without bound.
 */
function routeLabel(req) {
  const p = req.route?.path;
  return typeof p === "string" ? p : "unmatched";
}

function correlation(req, res, next) {
  const turnId = sanitizeTurnId(req.header(TURN_ID_HEADER));
  req.turnId = turnId;
  // Bound as `path`, not `route`: provider-call events use `route` for the
  // budget name (master|recognize|...) and pino would otherwise emit the
  // same key twice in one JSON line.
  req.log = log.child({ turnId, path: req.path });
  res.setHeader(TURN_ID_HEADER, turnId);

  const started = process.hrtime.bigint();
  // 'close' fires exactly once for every response — after 'finish' on a
  // normal completion, and *instead of* it when the client goes away
  // mid-stream. 'finish' alone would drop every interrupted master turn,
  // the most common outcome on that route.
  res.on("close", () => {
    const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
    const route = routeLabel(req);
    const completed = res.writableEnded;
    const status = completed ? String(res.statusCode) : "aborted";
    metrics.httpRequests.inc({ route, status });
    metrics.httpLatency.observe({ route }, latencyMs);
    req.log.info(
      {
        event: "http_request",
        method: req.method,
        route,
        status: completed ? res.statusCode : null,
        aborted: !completed,
        latency_ms: Math.round(latencyMs),
      },
      completed ? "request complete" : "request aborted by client",
    );
  });

  next();
}

module.exports = { correlation, TURN_ID_HEADER, sanitizeTurnId, routeLabel };
