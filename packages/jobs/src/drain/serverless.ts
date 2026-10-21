import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import {
  ALL_QUEUES,
  createRedisConnection,
  errorDetails,
  getQueue,
  getRedis,
  logger,
  type QueueNameValue,
} from "@taskbot/shared";
import { createDefaultDeps, type JobDeps } from "../deps";
import { drainLoop, type DrainStats, type JobSource } from "./loop";
import { processAndSettle } from "./settle";

export const DRAIN_LOCK_KEY = "worker:drain:lock";

const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0`;

/** Jobs are fetched manually, so the lock must outlive the longest single job. */
const JOB_LOCK_MS = 120_000;

export interface ServerlessDrainOptions {
  budgetMs?: number;
  lanes?: number;
  deps?: JobDeps;
}

export type ServerlessDrainResult =
  { status: "locked" } | ({ status: "drained"; rounds: number; ms: number } & DrainStats);

function bullmqSource(name: QueueNameValue, worker: Worker, deps: JobDeps): JobSource {
  const queue = getQueue(name);
  return {
    name,
    async next() {
      const token = randomUUID();
      const job = await worker.getNextJob(token, { block: false });
      if (!job) return null;
      return {
        queue: name,
        id: job.id ?? "unknown",
        run: () => processAndSettle(name, job, token, deps),
      };
    },
    async hasDelayed() {
      return (await queue.getDelayedCount()) > 0;
    },
  };
}

async function hasWaitingJobs(): Promise<boolean> {
  const counts = await Promise.all(ALL_QUEUES.map((name) => getQueue(name).getWaitingCount()));
  return counts.some((count) => count > 0);
}

/**
 * Serverless consumer for the BullMQ queues: processes jobs until the queues are empty
 * or the time budget runs out. A Redis lock ensures only one drain runs at a time;
 * any job enqueued meanwhile is picked up by the running drain.
 */
export async function runServerlessDrain(
  options: ServerlessDrainOptions = {},
): Promise<ServerlessDrainResult> {
  const budgetMs = options.budgetMs ?? 60_000;
  const redis = getRedis();
  const lockToken = randomUUID();
  const lockTtlSec = Math.ceil((budgetMs + JOB_LOCK_MS) / 1_000);

  const acquireLock = async () =>
    (await redis.set(DRAIN_LOCK_KEY, lockToken, "EX", lockTtlSec, "NX")) === "OK";
  const releaseLock = () => redis.eval(RELEASE_LOCK_SCRIPT, 1, DRAIN_LOCK_KEY, lockToken);

  if (!(await acquireLock())) return { status: "locked" };

  const startedAt = Date.now();
  const deps = options.deps ?? createDefaultDeps();
  const connection = createRedisConnection({ connectionName: "taskbot:drain" });
  const workers = ALL_QUEUES.map(
    (name) =>
      [
        name,
        new Worker(name, null, { connection, autorun: false, lockDuration: JOB_LOCK_MS }),
      ] as const,
  );

  for (const [name, worker] of workers) {
    worker.on("error", (err) =>
      logger.warn({ queue: name, err: errorDetails(err) }, "drain worker error"),
    );
    // Recovers jobs left "active" by a drain that was killed mid-job.
    void worker.startStalledCheckTimer();
  }

  const sources = workers.map(([name, worker]) => bullmqSource(name, worker, deps));
  const totals: DrainStats = { processed: 0, failed: 0, stoppedBy: "empty" };
  let rounds = 0;

  try {
    for (;;) {
      rounds++;
      const remaining = Math.max(0, budgetMs - (Date.now() - startedAt));
      const stats = await drainLoop({ sources, lanes: options.lanes ?? 3, budgetMs: remaining });
      totals.processed += stats.processed;
      totals.failed += stats.failed;
      totals.stoppedBy = stats.stoppedBy;
      await releaseLock();

      if (stats.stoppedBy === "budget") break;
      // Close the race where a job was enqueued after our last empty poll but before the lock
      // was released: its trigger saw the lock held and exited.
      if (!(await hasWaitingJobs()) || !(await acquireLock())) break;
    }
  } finally {
    await releaseLock().catch(() => undefined);
    await Promise.all(workers.map(([, worker]) => worker.close().catch(() => undefined)));
    await connection.quit().catch(() => connection.disconnect());
  }

  return { status: "drained", rounds, ms: Date.now() - startedAt, ...totals };
}
