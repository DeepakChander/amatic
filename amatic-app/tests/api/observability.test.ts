/**
 * Backend observability (docs/18 Phase 2): correlation ids, health split,
 * metrics endpoint, turn telemetry, and cost estimation.
 *
 * Boots the real Express app on an ephemeral port — server.js only listens
 * and installs signal handlers when it is the main module. Runs under the
 * repo's default jsdom environment (the global setup file needs it); the
 * server itself is plain Node and uses Node's fetch/http.
 */
import type { AddressInfo } from "net";
import type { Server } from "http";

// Keep pino quiet in test output. Must be set before server.js is required.
process.env.LOG_LEVEL = "silent";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require("../../server.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sanitizeTurnId } = require("../../api/lib/correlation.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { estimateCost } = require("../../api/lib/cost.js");

let server: Server;
let base: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("correlation ids", () => {
  it("echoes a well-formed x-turn-id back on the response", async () => {
    const res = await fetch(`${base}/healthz`, {
      headers: { "x-turn-id": "turn-abc123-XYZ_789" },
    });
    expect(res.headers.get("x-turn-id")).toBe("turn-abc123-XYZ_789");
  });

  it("mints an id when none is sent", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.headers.get("x-turn-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("replaces ids that are not plain short tokens", () => {
    expect(sanitizeTurnId("has spaces and <html>")).toMatch(/^[0-9a-f-]{36}$/);
    expect(sanitizeTurnId("x".repeat(65))).toMatch(/^[0-9a-f-]{36}$/);
    expect(sanitizeTurnId("short")).toMatch(/^[0-9a-f-]{36}$/);
    expect(sanitizeTurnId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(sanitizeTurnId("ok_id-12345678")).toBe("ok_id-12345678");
  });
});

describe("health endpoints", () => {
  it("/healthz is liveness only and always 200", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptime_s).toBe("number");
  });

  it("/readyz reports 503 with per-provider detail when no provider is configured", async () => {
    // Tests run without .env.local keys; readiness must say so, not "ok".
    const res = await fetch(`${base}/readyz`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ready).toBe(false);
    expect(body.providers).toHaveProperty("claude");
    expect(body.providers).toHaveProperty("gemini");
    expect(body.providers).toHaveProperty("elevenlabs");
  });

  it("legacy /health stays cheap and 200, and carries the last readiness result", async () => {
    // The /readyz test above has already run a probe round, so this must
    // reflect it without probing again.
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.models).toEqual({
      claude: !!process.env.ANTHROPIC_API_KEY,
      gemini: !!process.env.GOOGLE_AI_API_KEY,
      elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    });
    expect(body.readiness).toMatchObject({ ready: false, cached: true });
  });

  it("health and metrics are not rate limited", async () => {
    // The limiter allows 100/min per IP; this file has used a handful.
    // Burst well past it against /healthz and every call must still be 200.
    const results = await Promise.all(
      Array.from({ length: 120 }, () => fetch(`${base}/healthz`)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    // ...and those calls did not eat into the API routes' bucket either.
    const api = await fetch(`${base}/api/telemetry/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(api.status).toBe(204);
  });
});

describe("route labels", () => {
  it("never turns an arbitrary 404 path into a metrics label", async () => {
    await fetch(`${base}/zzz/not-a-route-${Date.now()}`);
    const text = await (await fetch(`${base}/metrics`)).text();
    expect(text).not.toContain("/zzz/not-a-route");
    expect(text).toContain('route="unmatched",status="404"');
  });
});

describe("metrics and turn telemetry", () => {
  it("POST /api/telemetry/turn returns 204 and counts the outcome", async () => {
    const before = await (await fetch(`${base}/metrics`)).text();
    const countOf = (text: string, series: string) => {
      const m = text.match(new RegExp(`^${series} (\\d+)`, "m"));
      return m ? Number(m[1]) : 0;
    };
    const errBefore = countOf(
      before,
      'amatic_turns_total\\{outcome="error"\\}',
    );
    const dropBefore = countOf(
      before,
      'amatic_worker_dropped_total\\{reason="full"\\}',
    );

    const res = await fetch(`${base}/api/telemetry/turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-turn-id": "turn-telemetry-test-1",
      },
      body: JSON.stringify({
        outcome: "error",
        durationMs: 1234,
        voiceSentences: 3,
        workers: {
          completed: 2,
          failed: 1,
          dropped: 2,
          droppedByReason: { full: 2 },
        },
        error: "The tutor is unavailable (HTTP 502).",
      }),
    });
    expect(res.status).toBe(204);

    const after = await (await fetch(`${base}/metrics`)).text();
    expect(countOf(after, 'amatic_turns_total\\{outcome="error"\\}')).toBe(
      errBefore + 1,
    );
    expect(
      countOf(after, 'amatic_worker_dropped_total\\{reason="full"\\}'),
    ).toBe(dropBefore + 2);
  });

  it("rejects unknown outcomes and drop reasons instead of creating label cardinality", async () => {
    const res = await fetch(`${base}/api/telemetry/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        outcome: "<script>",
        workers: { droppedByReason: { bogus: 5 } },
      }),
    });
    expect(res.status).toBe(204);
    const text = await (await fetch(`${base}/metrics`)).text();
    expect(text).not.toContain('outcome="<script>"');
    expect(text).not.toContain('reason="bogus"');
  });

  it("/metrics exposes the Phase 2.4 series with the prometheus content type", async () => {
    const res = await fetch(`${base}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    for (const series of [
      "amatic_turns_total",
      "amatic_llm_latency_ms",
      "amatic_llm_tokens_total",
      "amatic_llm_cost_usd_total",
      "amatic_recognize_confidence_total",
      "amatic_parser_rejects_total",
      "amatic_worker_dropped_total",
      "amatic_http_requests_total",
    ]) {
      expect(text).toContain(`# TYPE ${series}`);
    }
  });
});

describe("cost estimation", () => {
  it("prices claude-sonnet-5 usage from the docs/06 rates", () => {
    const usd = estimateCost("claude-sonnet-5", {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    // $2.00 input + $1.00 output
    expect(usd).toBeCloseTo(3.0, 6);
  });

  it("bills cache reads at 10% and cache writes at 125% of input", () => {
    const usd = estimateCost("claude-sonnet-5", {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
    });
    expect(usd).toBeCloseTo(0.2 + 2.5, 6);
  });

  it("returns null for models without a known rate rather than guessing", () => {
    expect(
      estimateCost("gemini-2.5-flash-image", { input_tokens: 10 }),
    ).toBeNull();
    expect(estimateCost("claude-sonnet-5", null)).toBeNull();
  });
});
