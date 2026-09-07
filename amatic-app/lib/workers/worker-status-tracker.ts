/**
 * Worker Status Tracker
 *
 * Real-time tracking of worker states and generation progress.
 * Provides progress updates for UI and monitoring.
 */

import type { GenerationProgress } from "@/types/master-plan";

export interface TaskStatus {
  taskId: number;
  workerId: number;
  status: "pending" | "generating" | "completed" | "failed";
  startedAt?: number;
  completedAt?: number;
  attempts: number;
  error?: string;
}

/**
 * Worker Status Tracker
 */
export class WorkerStatusTracker {
  private tasks: Map<number, TaskStatus> = new Map();
  private startTime: number = 0;

  /**
   * Initialize tracking for tasks
   */
  initialize(taskIds: number[]): void {
    this.startTime = Date.now();
    this.tasks.clear();

    for (const taskId of taskIds) {
      this.tasks.set(taskId, {
        taskId,
        workerId: 0,
        status: "pending",
        attempts: 0,
      });
    }
  }

  /**
   * Mark task as started
   */
  markStarted(taskId: number, workerId: number): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = "generating";
      task.workerId = workerId;
      task.startedAt = Date.now();
      task.attempts++;
    }
  }

  /**
   * Mark task as completed
   */
  markCompleted(taskId: number): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = "completed";
      task.completedAt = Date.now();
    }
  }

  /**
   * Mark task as failed
   */
  markFailed(taskId: number, error: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = "failed";
      task.error = error;
      task.completedAt = Date.now();
    }
  }

  /**
   * Get current progress
   */
  getProgress(): GenerationProgress {
    const total = this.tasks.size;
    const completed = Array.from(this.tasks.values()).filter(
      (t) => t.status === "completed",
    ).length;
    // const generating = Array.from(this.tasks.values())
    //   .filter(t => t.status === 'generating').length;
    // const failed = Array.from(this.tasks.values())
    //   .filter(t => t.status === 'failed').length;

    // Determine current phase
    let currentPhase: "planning" | "generating" | "narrating" | "complete" =
      "generating";
    if (total === 0) {
      currentPhase = "planning";
    } else if (completed === total) {
      currentPhase = "complete";
    } else if (completed > total * 0.8) {
      currentPhase = "narrating";
    }

    // Estimate time remaining
    const elapsedTime = Date.now() - this.startTime;
    const avgTimePerTask = completed > 0 ? elapsedTime / completed : 5000;
    const remainingTasks = total - completed;
    const estimatedTimeRemaining = (remainingTasks * avgTimePerTask) / 1000; // seconds

    return {
      completed,
      total,
      percentage: total > 0 ? (completed / total) * 100 : 0,
      currentPhase,
      estimatedTimeRemaining: Math.max(0, estimatedTimeRemaining),
    };
  }

  /**
   * Get detailed statistics
   */
  getStatistics(): {
    total: number;
    completed: number;
    generating: number;
    failed: number;
    pending: number;
    avgGenerationTime: number;
    fastestTime: number;
    slowestTime: number;
  } {
    const tasks = Array.from(this.tasks.values());
    const completedTasks = tasks.filter((t) => t.status === "completed");

    const generationTimes = completedTasks
      .filter((t) => t.startedAt && t.completedAt)
      .map((t) => t.completedAt! - t.startedAt!);

    return {
      total: tasks.length,
      completed: completedTasks.length,
      generating: tasks.filter((t) => t.status === "generating").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      pending: tasks.filter((t) => t.status === "pending").length,
      avgGenerationTime:
        generationTimes.length > 0
          ? generationTimes.reduce((a, b) => a + b, 0) / generationTimes.length
          : 0,
      fastestTime:
        generationTimes.length > 0 ? Math.min(...generationTimes) : 0,
      slowestTime:
        generationTimes.length > 0 ? Math.max(...generationTimes) : 0,
    };
  }

  /**
   * Get failed tasks for retry
   */
  getFailedTasks(): TaskStatus[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === "failed");
  }

  /**
   * Reset tracker
   */
  reset(): void {
    this.tasks.clear();
    this.startTime = 0;
  }
}

/**
 * Create worker status tracker
 */
export function createWorkerStatusTracker(): WorkerStatusTracker {
  return new WorkerStatusTracker();
}

export default {
  WorkerStatusTracker,
  createWorkerStatusTracker,
};
