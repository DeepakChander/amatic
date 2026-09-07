import { WorkerQueue } from "@/lib/ai/worker-queue";

/** A task whose completion the test controls. */
const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject, task: () => promise };
};

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("WorkerQueue", () => {
  it("runs up to `concurrency` tasks at once and queues the rest", async () => {
    const q = new WorkerQueue({
      concurrency: 3,
      maxQueued: 5,
      circuitThreshold: 3,
    });
    const tasks = Array.from({ length: 5 }, deferred);
    for (const t of tasks) {
      expect(q.enqueue(t.task)).toBe(true);
    }
    expect(q.stats()).toMatchObject({ running: 3, queued: 2, dropped: 0 });

    tasks[0].resolve();
    await tick();
    expect(q.stats()).toMatchObject({ running: 3, queued: 1, completed: 1 });

    tasks[1].resolve();
    tasks[2].resolve();
    tasks[3].resolve();
    tasks[4].resolve();
    await tick();
    expect(q.stats()).toMatchObject({ running: 0, queued: 0, completed: 5 });
  });

  it("does not silently drop briefs 4 and 5 (the docs/03 Stage 4 defect)", async () => {
    const started: number[] = [];
    const q = new WorkerQueue({
      concurrency: 3,
      maxQueued: 5,
      circuitThreshold: 3,
    });
    for (let i = 1; i <= 5; i++) {
      q.enqueue(async () => {
        started.push(i);
      });
    }
    await tick();
    await tick();
    expect(started).toEqual([1, 2, 3, 4, 5]);
    expect(q.stats().dropped).toBe(0);
  });

  it("counts and reports drops once the queue is at capacity", () => {
    const drops: string[] = [];
    const q = new WorkerQueue({
      concurrency: 1,
      maxQueued: 1,
      circuitThreshold: 3,
      onDrop: (r) => drops.push(r),
    });
    const a = deferred();
    expect(q.enqueue(a.task)).toBe(true); // running
    expect(q.enqueue(deferred().task)).toBe(true); // queued
    expect(q.enqueue(deferred().task)).toBe(false); // dropped
    expect(q.stats()).toMatchObject({ running: 1, queued: 1, dropped: 1 });
    expect(drops).toEqual(["full"]);
  });

  it("keeps dispatching after a single failure (no failure latch)", async () => {
    const failures: number[] = [];
    const q = new WorkerQueue({
      concurrency: 3,
      maxQueued: 5,
      circuitThreshold: 3,
      onFailure: (_e, n) => failures.push(n),
    });
    const ran: number[] = [];
    q.enqueue(async () => {
      throw new Error("provider 500");
    });
    for (let i = 2; i <= 5; i++) {
      q.enqueue(async () => {
        ran.push(i);
      });
    }
    await tick();
    await tick();
    expect(ran).toEqual([2, 3, 4, 5]);
    expect(failures).toEqual([1]);
    expect(q.stats()).toMatchObject({ failed: 1, completed: 4, dropped: 0 });
    expect(q.circuitOpen).toBe(false);
  });

  it("opens the circuit only after N consecutive failures and refuses new work", async () => {
    const drops: string[] = [];
    const q = new WorkerQueue({
      concurrency: 1,
      maxQueued: 10,
      circuitThreshold: 2,
      onDrop: (r) => drops.push(r),
    });
    const boom = async () => {
      throw new Error("x");
    };
    q.enqueue(boom);
    q.enqueue(boom);
    const never = vi.fn(async () => {});
    q.enqueue(never); // queued behind the two failures
    await tick();
    await tick();
    await tick();
    expect(q.circuitOpen).toBe(true);
    expect(never).not.toHaveBeenCalled();
    // The queued task was discarded when the circuit tripped, and is counted.
    expect(q.stats().dropped).toBe(1);
    expect(q.enqueue(never)).toBe(false);
    expect(drops).toEqual(["circuit", "circuit"]);
  });

  it("a success resets the consecutive failure count", async () => {
    const q = new WorkerQueue({
      concurrency: 1,
      maxQueued: 10,
      circuitThreshold: 2,
    });
    q.enqueue(async () => {
      throw new Error("1");
    });
    q.enqueue(async () => {});
    q.enqueue(async () => {
      throw new Error("2");
    });
    await tick();
    await tick();
    await tick();
    expect(q.stats()).toMatchObject({
      failed: 2,
      completed: 1,
      consecutiveFailures: 1,
    });
    expect(q.circuitOpen).toBe(false);
  });

  it("treats a synchronously-throwing task as a failure, not an exception for the caller", async () => {
    const q = new WorkerQueue({
      concurrency: 1,
      maxQueued: 1,
      circuitThreshold: 5,
    });
    expect(() =>
      q.enqueue(() => {
        throw new Error("sync");
      }),
    ).not.toThrow();
    await tick();
    expect(q.stats().failed).toBe(1);
  });

  it("close() discards pending work and refuses new tasks as 'closed'", async () => {
    const drops: string[] = [];
    const q = new WorkerQueue({
      concurrency: 1,
      maxQueued: 5,
      circuitThreshold: 3,
      onDrop: (r) => drops.push(r),
    });
    const a = deferred();
    const later = vi.fn(async () => {});
    q.enqueue(a.task);
    q.enqueue(later);
    q.close();
    expect(q.stats().queued).toBe(0);
    expect(q.enqueue(later)).toBe(false);
    expect(drops).toEqual(["closed"]);
    a.resolve();
    await tick();
    expect(later).not.toHaveBeenCalled();
  });
});
