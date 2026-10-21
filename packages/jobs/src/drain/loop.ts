export interface LeasedJob {
  queue: string;
  id: string;
  /** Processes and settles the job; resolves to true on success. */
  run(): Promise<boolean>;
}

export interface JobSource {
  name: string;
  /** Non-blocking: returns null when nothing is ready right now. */
  next(): Promise<LeasedJob | null>;
  /** Retries waiting for their backoff delay. */
  hasDelayed(): Promise<boolean>;
}

export interface DrainLoopOptions {
  /** Polled in order, so earlier pipeline stages are preferred. */
  sources: JobSource[];
  lanes?: number;
  budgetMs: number;
  idleWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface DrainStats {
  processed: number;
  failed: number;
  stoppedBy: "empty" | "budget";
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `lanes` concurrent consumers until every source is empty or the time budget is used up.
 * A lane that finds nothing keeps waiting while another lane is busy (its job may enqueue the
 * next pipeline stage) or while retries are delayed; otherwise it exits.
 */
export async function drainLoop({
  sources,
  lanes = 3,
  budgetMs,
  idleWaitMs = 500,
  now = Date.now,
  sleep = defaultSleep,
}: DrainLoopOptions): Promise<DrainStats> {
  const deadline = now() + budgetMs;
  let processed = 0;
  let failed = 0;
  let inFlight = 0;
  let hitBudget = false;

  async function nextJob(): Promise<LeasedJob | null> {
    for (const source of sources) {
      const job = await source.next();
      if (job) return job;
    }
    return null;
  }

  async function anyDelayed(): Promise<boolean> {
    for (const source of sources) {
      if (await source.hasDelayed()) return true;
    }
    return false;
  }

  async function lane(): Promise<void> {
    for (;;) {
      if (now() >= deadline) {
        hitBudget = true;
        return;
      }
      const job = await nextJob();
      if (job) {
        inFlight++;
        try {
          if (await job.run()) processed++;
          else failed++;
        } catch {
          failed++;
        } finally {
          inFlight--;
        }
        continue;
      }
      if (inFlight === 0 && !(await anyDelayed())) return;
      await sleep(idleWaitMs);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, lanes) }, lane));
  return { processed, failed, stoppedBy: hitBudget ? "budget" : "empty" };
}
