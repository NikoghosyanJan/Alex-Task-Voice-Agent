import type { Job } from "bullmq";
import type { QueueNameValue } from "@taskbot/shared";
import type { JobDeps } from "../deps";
import { handleFinalFailure } from "../failure";
import { runJob } from "../processors";

/**
 * Manual-mode processing for a job fetched with `worker.getNextJob(token)`.
 * `moveToFailed` applies the attempts/backoff policy; a job that ends up in the
 * "failed" state will not be retried, so the user is told what went wrong.
 */
export async function processAndSettle(
  queue: QueueNameValue,
  job: Job,
  token: string,
  deps: JobDeps,
): Promise<boolean> {
  try {
    const result = await runJob(queue, job, deps);
    await job.moveToCompleted(result ?? null, token, false);
    return true;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    await job.moveToFailed(error, token, false);
    if ((await job.getState()) === "failed") {
      await handleFinalFailure(queue, job.data, error, deps);
    }
    return false;
  }
}
