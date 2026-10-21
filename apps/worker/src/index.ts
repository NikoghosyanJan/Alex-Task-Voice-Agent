import "./loadEnv";
import { Worker } from "bullmq";
import { disconnectPrisma } from "@taskbot/db";
import { createDefaultDeps, handleFinalFailure, runJob } from "@taskbot/jobs";
import {
  ALL_QUEUES,
  closeSharedRedis,
  createRedisConnection,
  errorDetails,
  logger,
  QueueName,
  type QueueNameValue,
} from "@taskbot/shared";

/** Transcription is I/O bound (download + OpenAI), so it gets the most parallelism. */
const CONCURRENCY: Record<QueueNameValue, number> = {
  [QueueName.Transcription]: 4,
  [QueueName.TaskProcessing]: 4,
  [QueueName.Notifications]: 8,
};

const deps = createDefaultDeps();
const connection = createRedisConnection({ connectionName: "taskbot:worker" });

const workers = ALL_QUEUES.map((queue) => {
  const worker = new Worker(queue, (job) => runJob(queue, job, deps), {
    connection,
    concurrency: CONCURRENCY[queue],
    lockDuration: 120_000,
  });

  worker.on("failed", async (job, err) => {
    if (!job) return;
    try {
      // "failed" fires on every failed attempt; only a job in the failed state is final.
      if ((await job.getState()) === "failed") {
        await handleFinalFailure(queue, job.data, err, deps);
      }
    } catch (handlerErr) {
      logger.error(
        { queue, jobId: job.id, err: errorDetails(handlerErr) },
        "failure handler crashed",
      );
    }
  });
  worker.on("error", (err) => logger.error({ queue, err: errorDetails(err) }, "worker error"));
  worker.on("stalled", (jobId) => logger.warn({ queue, jobId }, "job stalled, will be retried"));

  return worker;
});

logger.info({ queues: ALL_QUEUES, concurrency: CONCURRENCY }, "worker started");

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down, waiting for active jobs");
  const forceExit = setTimeout(() => {
    logger.error("graceful shutdown timed out");
    process.exit(1);
  }, 30_000);
  forceExit.unref();

  try {
    await Promise.all(workers.map((worker) => worker.close()));
    await connection.quit();
    await closeSharedRedis();
    await disconnectPrisma();
    logger.info("worker stopped");
    process.exit(0);
  } catch (err) {
    logger.error({ err: errorDetails(err) }, "error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error({ err: errorDetails(reason) }, "unhandled rejection");
});
