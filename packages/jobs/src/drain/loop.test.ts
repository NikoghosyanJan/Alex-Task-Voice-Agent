import { describe, expect, it } from "vitest";
import { drainLoop, type JobSource, type LeasedJob } from "./loop";

interface FakeJob {
  id: string;
  ok?: boolean;
  /** Jobs to enqueue into another source when this one finishes (pipeline stages). */
  spawns?: { source: FakeSource; job: FakeJob };
  durationMs?: number;
}

class FakeSource implements JobSource {
  readonly queue: FakeJob[] = [];
  delayed = 0;
  processed: string[] = [];

  constructor(readonly name: string) {}

  async next(): Promise<LeasedJob | null> {
    const job = this.queue.shift();
    if (!job) return null;
    return {
      queue: this.name,
      id: job.id,
      run: async () => {
        if (job.durationMs) await new Promise((resolve) => setTimeout(resolve, job.durationMs));
        this.processed.push(job.id);
        if (job.spawns) job.spawns.source.queue.push(job.spawns.job);
        return job.ok !== false;
      },
    };
  }

  async hasDelayed(): Promise<boolean> {
    return this.delayed > 0;
  }
}

describe("drainLoop", () => {
  it("processes every job across sources and reports failures", async () => {
    const a = new FakeSource("a");
    const b = new FakeSource("b");
    a.queue.push({ id: "a1" }, { id: "a2", ok: false });
    b.queue.push({ id: "b1" });

    const stats = await drainLoop({ sources: [a, b], lanes: 2, budgetMs: 1_000, idleWaitMs: 1 });
    expect(stats).toEqual({ processed: 2, failed: 1, stoppedBy: "empty" });
    expect([...a.processed, ...b.processed].sort()).toEqual(["a1", "a2", "b1"]);
  });

  it("follows a pipeline: jobs enqueued by running jobs are picked up in the same drain", async () => {
    const transcription = new FakeSource("transcription");
    const tasks = new FakeSource("tasks");
    const notify = new FakeSource("notify");
    transcription.queue.push({
      id: "voice",
      durationMs: 20,
      spawns: {
        source: tasks,
        job: { id: "task", spawns: { source: notify, job: { id: "card" } } },
      },
    });

    const stats = await drainLoop({
      sources: [transcription, tasks, notify],
      lanes: 3,
      budgetMs: 1_000,
      idleWaitMs: 2,
    });
    expect(stats.processed).toBe(3);
    expect(notify.processed).toEqual(["card"]);
  });

  it("waits for delayed retries instead of exiting early", async () => {
    const source = new FakeSource("a");
    source.delayed = 1;
    setTimeout(() => {
      source.delayed = 0;
      source.queue.push({ id: "retried" });
    }, 15);

    const stats = await drainLoop({ sources: [source], lanes: 1, budgetMs: 1_000, idleWaitMs: 5 });
    expect(stats.processed).toBe(1);
    expect(source.processed).toEqual(["retried"]);
  });

  it("stops picking up work when the time budget is spent", async () => {
    let clock = 0;
    const source = new FakeSource("a");
    for (let i = 0; i < 10; i++) source.queue.push({ id: `j${i}` });
    const original = source.next.bind(source);
    source.next = async () => {
      clock += 40;
      return original();
    };

    const stats = await drainLoop({ sources: [source], lanes: 1, budgetMs: 100, now: () => clock });
    expect(stats.stoppedBy).toBe("budget");
    expect(stats.processed).toBeLessThan(10);
    expect(source.queue.length).toBeGreaterThan(0);
  });

  it("counts a crashing job as failed and keeps going", async () => {
    const source = new FakeSource("a");
    source.queue.push({ id: "ok" });
    const original = source.next.bind(source);
    let first = true;
    source.next = async () => {
      if (first) {
        first = false;
        return { queue: "a", id: "boom", run: async () => Promise.reject(new Error("crash")) };
      }
      return original();
    };

    expect(await drainLoop({ sources: [source], lanes: 1, budgetMs: 1_000 })).toEqual({
      processed: 1,
      failed: 1,
      stoppedBy: "empty",
    });
  });
});
