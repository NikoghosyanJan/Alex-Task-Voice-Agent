import { UnrecoverableError } from "bullmq";
import {
  AppError,
  classifyError,
  errorDetails,
  formatJobErrorMessage,
  jobSchemas,
  type JobDataMap,
  type QueueNameValue,
} from "@taskbot/shared";
import type { JobContext } from "../context";
import type { JobDeps } from "../deps";
import { processNotification } from "./notifications";
import { processTaskJob } from "./taskProcessing";
import { processTranscription } from "./transcription";

type Processor<N extends QueueNameValue> = (
  data: JobDataMap[N],
  ctx: JobContext,
  deps: JobDeps,
) => Promise<unknown>;

export const processors: { [N in QueueNameValue]: Processor<N> } = {
  transcription: processTranscription,
  "task-processing": processTaskJob,
  notifications: processNotification,
};

/** The subset of a BullMQ Job that processing needs. */
export interface RunnableJob {
  id?: string;
  data: unknown;
  attemptsMade: number;
  opts: { attempts?: number };
}

/**
 * Validates the payload, runs the processor and maps failures for BullMQ:
 * non-retryable errors become UnrecoverableError (no more attempts), and every
 * error message carries its code so the final-failure handler can explain it to the user.
 */
export async function runJob(
  queue: QueueNameValue,
  job: RunnableJob,
  deps: JobDeps,
): Promise<unknown> {
  const jobId = job.id ?? "unknown";
  const maxAttempts = job.opts.attempts ?? 1;
  const log = deps.log.child({ queue, jobId, attempt: job.attemptsMade + 1 });

  const parsed = jobSchemas[queue].safeParse(job.data);
  if (!parsed.success) {
    log.error({ issues: parsed.error.issues }, "invalid job payload");
    throw new UnrecoverableError(
      formatJobErrorMessage(new AppError("INVALID_JOB", parsed.error.message)),
    );
  }

  const ctx: JobContext = {
    jobId,
    queue,
    attemptsMade: job.attemptsMade,
    maxAttempts,
    isFinalAttempt: job.attemptsMade + 1 >= maxAttempts,
    log,
  };

  const startedAt = Date.now();
  try {
    const run = processors[queue] as Processor<QueueNameValue>;
    const result = await run(parsed.data, ctx, deps);
    log.info({ ms: Date.now() - startedAt }, "job completed");
    return result;
  } catch (err) {
    const error = classifyError(err);
    log.warn(
      {
        ms: Date.now() - startedAt,
        code: error.code,
        retryable: error.retryable,
        err: errorDetails(err),
      },
      "job attempt failed",
    );
    const message = formatJobErrorMessage(error);
    if (!error.retryable) throw new UnrecoverableError(message);
    throw new Error(message, { cause: err });
  }
}
