import {
  classifyError,
  errorDetails,
  fallbackTask,
  QueueName,
  type StructuredTask,
  type TaskProcessingJob,
} from "@taskbot/shared";
import type { JobContext } from "../context";
import type { JobDeps } from "../deps";

export async function processTaskJob(
  data: TaskProcessingJob,
  ctx: JobContext,
  deps: JobDeps,
): Promise<{ taskId: string; created: boolean; structured: boolean }> {
  let structured: StructuredTask;
  let usedAi = true;
  try {
    structured = await deps.ai.structure(data.text);
  } catch (err) {
    const error = classifyError(err);
    // Retry transient AI failures, but never lose the user's task: degrade to the raw text.
    if (error.retryable && !ctx.isFinalAttempt) throw err;
    ctx.log.warn(
      { code: error.code, err: errorDetails(err) },
      "AI structuring failed, using raw text",
    );
    structured = fallbackTask(data.text);
    usedAi = false;
  }

  const { record, created } = await deps.tasks.createFromTelegram({
    ...structured,
    userId: data.userId,
    updateId: data.updateId,
    source: data.source,
    originalText: data.text,
    transcript: data.transcript ?? null,
  });

  await deps.enqueue(
    QueueName.Notifications,
    {
      kind: "task_created",
      taskId: record.task.id,
      chatId: data.chatId,
      statusMessageId: data.statusMessageId,
    },
    { jobId: `notify-created-${record.task.id}` },
  );

  return { taskId: record.task.id, created, structured: usedAi };
}
