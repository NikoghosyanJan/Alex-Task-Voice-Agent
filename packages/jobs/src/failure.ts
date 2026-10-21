import {
  codeFromJobError,
  errorDetails,
  QueueName,
  taskProcessingJobSchema,
  transcriptionJobSchema,
  USER_MESSAGES,
  type QueueNameValue,
} from "@taskbot/shared";
import type { JobDeps } from "./deps";
import { messages, showStatus } from "./telegram/messages";

/** Called once a job has exhausted its attempts (or failed unrecoverably). */
export async function handleFinalFailure(
  queue: QueueNameValue,
  data: unknown,
  err: unknown,
  deps: Pick<JobDeps, "telegram" | "log">,
): Promise<void> {
  const code = codeFromJobError(err);
  const reason = USER_MESSAGES[code];
  deps.log.error({ queue, code, err: errorDetails(err) }, "job failed permanently");

  try {
    if (queue === QueueName.Transcription) {
      const job = transcriptionJobSchema.safeParse(data);
      if (job.success) {
        await showStatus(
          deps.telegram,
          job.data.chatId,
          job.data.statusMessageId,
          messages.voiceFailed(reason),
        );
      }
    } else if (queue === QueueName.TaskProcessing) {
      const job = taskProcessingJobSchema.safeParse(data);
      if (job.success) {
        await showStatus(
          deps.telegram,
          job.data.chatId,
          job.data.statusMessageId,
          messages.taskFailed(reason),
        );
      }
    }
  } catch (notifyErr) {
    deps.log.error({ queue, err: errorDetails(notifyErr) }, "could not notify user about failure");
  }
}
