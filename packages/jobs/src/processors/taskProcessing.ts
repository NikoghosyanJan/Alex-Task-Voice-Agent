import {
  AppError,
  classifyError,
  errorDetails,
  fallbackTask,
  QueueName,
  type MessagePlan,
  type TaskDTO,
  type TaskProcessingJob,
} from "@taskbot/shared";
import { serializeChanges, type PendingAction } from "../actions/pendingActions";
import type { JobContext } from "../context";
import type { JobDeps } from "../deps";

/** How many of the user's recent tasks the AI sees when resolving "task 5" or "the dentist one". */
export const TASK_CONTEXT_LIMIT = 50;

function toPendingAction(
  plan: Exclude<MessagePlan, { action: "clarify" }>,
  data: TaskProcessingJob,
  tasks: TaskDTO[],
): PendingAction {
  const common = {
    id: String(data.updateId),
    telegramUserId: data.telegramUserId,
    userId: data.userId,
    chatId: data.chatId,
    transcript: data.transcript ?? null,
  };

  if (plan.action === "create") {
    return {
      ...common,
      kind: "create",
      updateId: data.updateId,
      source: data.source,
      originalText: data.text,
      task: { ...plan.task, dueDate: plan.task.dueDate?.toISOString() ?? null },
    };
  }

  const target = tasks.find((task) => task.number === plan.taskNumber);
  if (!target) {
    throw new AppError("AI_BAD_OUTPUT", `plan refers to unknown task #${plan.taskNumber}`);
  }
  const before = {
    number: target.number,
    title: target.title,
    description: target.description,
    priority: target.priority,
    dueDate: target.dueDate,
    status: target.status,
  };
  if (plan.action === "delete") {
    return { ...common, kind: "delete", taskId: target.id, before };
  }
  return {
    ...common,
    kind: "update",
    taskId: target.id,
    before,
    changes: serializeChanges(plan.changes),
  };
}

/**
 * Works out what the user wants (create a task, or change or delete one of theirs) and proposes it.
 * Nothing is written to the database here: the user confirms the plan in Telegram first.
 */
export async function processTaskJob(
  data: TaskProcessingJob,
  ctx: JobContext,
  deps: JobDeps,
): Promise<{ action: MessagePlan["action"]; actionId: string | null; usedAi: boolean }> {
  const tasks = await deps.tasks.listForTelegramUser(data.telegramUserId, TASK_CONTEXT_LIMIT);

  let plan: MessagePlan;
  let usedAi = true;
  try {
    plan = await deps.ai.interpret(data.text, { tasks, replyTo: data.replyToText });
  } catch (err) {
    const error = classifyError(err);
    // Retry transient AI failures, but never lose the user's message: offer it as a task.
    if (error.retryable && !ctx.isFinalAttempt) throw err;
    ctx.log.warn({ code: error.code, err: errorDetails(err) }, "AI failed, proposing raw text");
    plan = { action: "create", task: fallbackTask(data.text) };
    usedAi = false;
  }

  if (plan.action === "clarify") {
    await deps.enqueue(
      QueueName.Notifications,
      {
        kind: "reply",
        chatId: data.chatId,
        statusMessageId: data.statusMessageId,
        text: plan.message,
      },
      { jobId: `notify-reply-${data.updateId}` },
    );
    return { action: plan.action, actionId: null, usedAi };
  }

  const action = toPendingAction(plan, data, tasks);
  await deps.actions.save(action);
  await deps.enqueue(
    QueueName.Notifications,
    {
      kind: "action_proposed",
      actionId: action.id,
      chatId: data.chatId,
      statusMessageId: data.statusMessageId,
    },
    { jobId: `notify-proposal-${data.updateId}` },
  );
  return { action: plan.action, actionId: action.id, usedAi };
}
