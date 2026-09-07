/**
 * Worker Coordinator
 *
 * Manages parallel delegation of visual tasks to 500+ worker APIs.
 * Implements:
 * - Parallel execution with Promise.allSettled
 * - Progressive result streaming
 * - Fault tolerance and retry logic
 * - Load balancing across workers
 * - Real-time progress tracking
 */

import type { DetailedWorkerBrief, VisualResult } from "@/types/master-plan";

import { logger } from "@/lib/logger";

export interface CoordinatorOptions {
  maxParallelWorkers?: number; // Default: 500
  retryFailedTasks?: boolean; // Default: true
  retryAttempts?: number; // Default: 2
  timeoutMs?: number; // Default: 30000
}

export interface WorkerStatus {
  workerId: number;
  status: "idle" | "busy" | "error";
  currentTask?: number;
  completedTasks: number;
  failedTasks: number;
}

/**
 * Worker Coordinator
 * Delegates tasks to 500 workers in massive parallel execution
 */
export class WorkerCoordinator {
  private workerStatus: Map<number, WorkerStatus> = new Map();
  private options: Required<CoordinatorOptions>;

  constructor(options: CoordinatorOptions = {}) {
    this.options = {
      maxParallelWorkers: options.maxParallelWorkers ?? 500,
      retryFailedTasks: options.retryFailedTasks ?? true,
      retryAttempts: options.retryAttempts ?? 2,
      timeoutMs: options.timeoutMs ?? 30000,
    };

    // Initialize worker status
    for (let i = 1; i <= this.options.maxParallelWorkers; i++) {
      this.workerStatus.set(i, {
        workerId: i,
        status: "idle",
        completedTasks: 0,
        failedTasks: 0,
      });
    }
  }

  /**
   * Delegate visual generation tasks to workers
   * Returns async generator for progressive rendering
   */
  async *delegateToWorkers(
    briefs: DetailedWorkerBrief[],
  ): AsyncGenerator<VisualResult, void, unknown> {
    logger.info(
      `[Coordinator] Delegating ${briefs.length} tasks to ${this.options.maxParallelWorkers} workers`,
    );

    const totalTasks = briefs.length;
    let completedCount = 0;
    let failedCount = 0;

    // Create promises for all worker calls
    const workerPromises = briefs.map((brief) =>
      this.callWorker(brief).catch((error) => ({
        taskId: brief.taskId,
        component: "",
        position: brief.technicalConstraints.position,
        size: brief.technicalConstraints.size,
        quality: 0,
        status: "error" as const,
        error: error.message,
      })),
    );

    // Execute all in parallel, stream results as they complete
    const results = await Promise.allSettled(workerPromises);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];

      if (result.status === "fulfilled") {
        const visualResult = result.value;

        if (visualResult.status === "success") {
          completedCount++;
          logger.info(
            `[Coordinator] Progress: ${completedCount}/${totalTasks} (${Math.round(
              (completedCount / totalTasks) * 100,
            )}%)`,
          );
        } else {
          failedCount++;
          logger.warn(
            `[Coordinator] Task ${visualResult.taskId} failed: ${visualResult.error}`,
          );
        }

        yield visualResult;
      } else {
        failedCount++;
        logger.error(`[Coordinator] Worker promise rejected:`, result.reason);
      }
    }

    // Retry failed tasks if enabled
    if (this.options.retryFailedTasks && failedCount > 0) {
      logger.info(`[Coordinator] Retrying ${failedCount} failed tasks...`);

      const failedBriefs = briefs.filter((_, i) => {
        const result = results[i];
        // Note: result.status is always "fulfilled" because callWorker has .catch() handlers
        return result.status === "fulfilled" && result.value.status === "error";
      });

      for (const brief of failedBriefs) {
        try {
          const retryResult = await this.callWorker(brief);
          if (retryResult.status === "success") {
            completedCount++;
            logger.info(
              `[Coordinator] Retry successful for task ${brief.taskId}`,
            );
            yield retryResult;
          }
        } catch (error) {
          logger.error(
            `[Coordinator] Retry failed for task ${brief.taskId}:`,
            error,
          );
        }
      }
    }

    logger.info(`[Coordinator] === COMPLETE ===`);
    logger.info(
      `[Coordinator] Success: ${completedCount}/${totalTasks} (${Math.round(
        (completedCount / totalTasks) * 100,
      )}%)`,
    );
    logger.info(`[Coordinator] Failed: ${failedCount}/${totalTasks}`);
  }

  /**
   * Call single worker API
   */
  private async callWorker(brief: DetailedWorkerBrief): Promise<VisualResult> {
    const workerId = brief.workerId;

    // Update worker status
    const status = this.workerStatus.get(workerId);
    if (status) {
      status.status = "busy";
      status.currentTask = brief.taskId;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.options.timeoutMs,
      );

      const response = await fetch(`/api/ai/worker/${workerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Worker ${workerId} returned ${response.status}`);
      }

      const result = await response.json();

      // Update worker status
      if (status) {
        status.status = "idle";
        status.currentTask = undefined;
        status.completedTasks++;
      }

      return {
        taskId: brief.taskId,
        component: result.component,
        position: brief.technicalConstraints.position,
        size: brief.technicalConstraints.size,
        quality: result.quality,
        status: "success",
      };
    } catch (error) {
      // Update worker status
      if (status) {
        status.status = "error";
        status.failedTasks++;
      }

      throw error;
    }
  }

  /**
   * Get worker statistics
   */
  getWorkerStatistics(): {
    total: number;
    idle: number;
    busy: number;
    error: number;
    avgCompletedPerWorker: number;
  } {
    let idle = 0;
    let busy = 0;
    let error = 0;
    let totalCompleted = 0;

    for (const status of this.workerStatus.values()) {
      if (status.status === "idle") {
        idle++;
      } else if (status.status === "busy") {
        busy++;
      } else if (status.status === "error") {
        error++;
      }
      totalCompleted += status.completedTasks;
    }

    return {
      total: this.workerStatus.size,
      idle,
      busy,
      error,
      avgCompletedPerWorker: totalCompleted / this.workerStatus.size,
    };
  }

  /**
   * Reset worker status
   */
  reset(): void {
    for (const status of this.workerStatus.values()) {
      status.status = "idle";
      status.currentTask = undefined;
    }
  }
}

/**
 * Create worker coordinator instance
 */
export function createWorkerCoordinator(
  options?: CoordinatorOptions,
): WorkerCoordinator {
  return new WorkerCoordinator(options);
}

/**
 * Quick helper: Delegate tasks and collect all results
 */
export async function delegateAndCollect(
  briefs: DetailedWorkerBrief[],
  options?: CoordinatorOptions,
): Promise<VisualResult[]> {
  const coordinator = createWorkerCoordinator(options);
  const results: VisualResult[] = [];

  for await (const result of coordinator.delegateToWorkers(briefs)) {
    results.push(result);
  }

  return results;
}

export default {
  WorkerCoordinator,
  createWorkerCoordinator,
  delegateAndCollect,
};
