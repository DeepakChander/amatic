/**
 * Bounded task queue for Gemini image workers.
 *
 * Replaces the previous `activeWorkerCountRef` counter + `workerFailedRef`
 * latch in useCanvasJarvis, which had two defects (docs/03 Stage 4):
 *
 *  - Silent drop: past `concurrency` in-flight tasks, new dispatches returned
 *    early, so briefs 4-5 of a 5-brief teaching turn never rendered.
 *  - Failure latch: one failed worker blocked every later dispatch in the turn.
 *
 * This queue runs at most `concurrency` tasks at once, holds up to `maxQueued`
 * more, counts anything beyond that as `dropped` (visible, not silent), and
 * only opens its circuit after `circuitThreshold` *consecutive* failures. A
 * success resets the consecutive-failure count.
 *
 * Pure TypeScript, no React — see tests/ai/worker-queue.test.ts.
 */

export interface WorkerQueueOptions {
  /** Max tasks running at the same time. */
  concurrency: number;
  /** Max tasks waiting behind the running ones; further tasks are dropped. */
  maxQueued: number;
  /** Consecutive failures that open the circuit and reject new tasks. */
  circuitThreshold: number;
  /** Called on every task failure with the error and the running failure streak. */
  onFailure?: (err: unknown, consecutiveFailures: number) => void;
  /** Called when a task is refused: `"full"` (queue at capacity), `"circuit"`
   *  (tripped after consecutive failures) or `"closed"` (queue shut down). */
  onDrop?: (reason: WorkerDropReason) => void;
}

export type WorkerDropReason = "full" | "circuit" | "closed";

export interface WorkerQueueStats {
  running: number;
  queued: number;
  completed: number;
  failed: number;
  dropped: number;
  consecutiveFailures: number;
  circuitOpen: boolean;
}

type Task = () => Promise<void>;

export class WorkerQueue {
  private readonly opts: WorkerQueueOptions;
  private readonly pending: Task[] = [];
  private running = 0;
  private completed = 0;
  private failed = 0;
  private dropped = 0;
  private consecutiveFailures = 0;
  private closed = false;

  constructor(opts: WorkerQueueOptions) {
    if (opts.concurrency < 1) {
      throw new Error("WorkerQueue: concurrency must be >= 1");
    }
    if (opts.maxQueued < 0) {
      throw new Error("WorkerQueue: maxQueued must be >= 0");
    }
    if (opts.circuitThreshold < 1) {
      throw new Error("WorkerQueue: circuitThreshold must be >= 1");
    }
    this.opts = opts;
  }

  get circuitOpen(): boolean {
    return this.consecutiveFailures >= this.opts.circuitThreshold;
  }

  /**
   * Enqueue a task. Returns `true` if it was accepted (will run now or later),
   * `false` if dropped because the queue is full, the circuit is open, or the
   * queue has been closed.
   */
  enqueue(task: Task): boolean {
    if (this.closed) {
      this.dropped++;
      this.opts.onDrop?.("closed");
      return false;
    }
    if (this.circuitOpen) {
      this.dropped++;
      this.opts.onDrop?.("circuit");
      return false;
    }
    if (this.running < this.opts.concurrency) {
      this.run(task);
      return true;
    }
    if (this.pending.length < this.opts.maxQueued) {
      this.pending.push(task);
      return true;
    }
    this.dropped++;
    this.opts.onDrop?.("full");
    return false;
  }

  /**
   * Stop accepting tasks and discard anything still waiting. Tasks already
   * running are not interrupted here — callers abort them via their own
   * AbortSignal.
   */
  close(): void {
    this.closed = true;
    this.pending.length = 0;
  }

  stats(): WorkerQueueStats {
    return {
      running: this.running,
      queued: this.pending.length,
      completed: this.completed,
      failed: this.failed,
      dropped: this.dropped,
      consecutiveFailures: this.consecutiveFailures,
      circuitOpen: this.circuitOpen,
    };
  }

  private run(task: Task): void {
    this.running++;
    // Deferred so a synchronously-throwing task is still counted as a failure
    // rather than escaping to the caller of enqueue().
    Promise.resolve()
      .then(task)
      .then(
        () => {
          this.completed++;
          this.consecutiveFailures = 0;
        },
        (err: unknown) => {
          this.failed++;
          this.consecutiveFailures++;
          this.opts.onFailure?.(err, this.consecutiveFailures);
        },
      )
      .finally(() => {
        this.running--;
        this.drain();
      });
  }

  private drain(): void {
    if (this.closed) {
      return;
    }
    while (this.running < this.opts.concurrency && this.pending.length > 0) {
      if (this.circuitOpen) {
        // Everything still waiting is now refused; count it so it is visible.
        const n = this.pending.length;
        this.pending.length = 0;
        this.dropped += n;
        for (let i = 0; i < n; i++) {
          this.opts.onDrop?.("circuit");
        }
        return;
      }
      this.run(this.pending.shift()!);
    }
  }
}
