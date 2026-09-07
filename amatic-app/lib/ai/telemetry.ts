/**
 * Client-side telemetry for the teaching loop.
 *
 * The backend owns real metrics (/metrics, Phase 2). This module exists for
 * failures the backend never sees — a fetch that never reached it, a
 * background recognition that threw in the browser — so they are counted and
 * logged instead of disappearing into an empty catch (docs/18 Phase 1.2).
 *
 * Counters live for the page session and can be read from the devtools
 * console via `window.__amaticMetrics()`.
 */

import type { WorkerDropReason } from "./worker-queue";

export interface ClientMetrics {
  recognizeFailures: number;
  workerFailures: number;
  workerDropped: number;
  masterErrors: number;
}

const metrics: ClientMetrics = {
  recognizeFailures: 0,
  workerFailures: 0,
  workerDropped: 0,
  masterErrors: 0,
};

export const getClientMetrics = (): Readonly<ClientMetrics> => ({ ...metrics });

/** Test-only. */
export const resetClientMetrics = (): void => {
  metrics.recognizeFailures = 0;
  metrics.workerFailures = 0;
  metrics.workerDropped = 0;
  metrics.masterErrors = 0;
};

const describeError = (err: unknown): string => {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  return String(err);
};

/**
 * Structured warning. One line, JSON-ish, always carries the turn/recognition
 * id so it can be matched against backend logs by the same id.
 */
const warn = (event: string, fields: Record<string, unknown>): void => {
  // eslint-disable-next-line no-console
  console.warn(`[amatic] ${event}`, fields);
};

export const recordRecognizeFailure = (
  err: unknown,
  recognitionId: string,
): void => {
  metrics.recognizeFailures++;
  warn("recognize_failed", {
    recognitionId,
    count: metrics.recognizeFailures,
    error: describeError(err),
  });
};

export const recordWorkerFailure = (
  err: unknown,
  turnId: string,
  consecutiveFailures: number,
): void => {
  metrics.workerFailures++;
  warn("worker_failed", {
    turnId,
    consecutiveFailures,
    count: metrics.workerFailures,
    error: describeError(err),
  });
};

export const recordWorkerDropped = (
  turnId: string,
  reason: WorkerDropReason,
): void => {
  metrics.workerDropped++;
  warn("worker_dropped", { turnId, reason, count: metrics.workerDropped });
};

export const recordMasterError = (turnId: string, message: string): void => {
  metrics.masterErrors++;
  warn("master_error", { turnId, message, count: metrics.masterErrors });
};

/** Generate an id for a turn or a background recognition. */
export const newCorrelationId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // jsdom / very old browsers
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
};

declare global {
  interface Window {
    __amaticMetrics?: () => Readonly<ClientMetrics>;
  }
}

if (typeof window !== "undefined") {
  window.__amaticMetrics = getClientMetrics;
}
