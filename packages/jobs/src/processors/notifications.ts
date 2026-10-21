import type { NotificationJob } from "@taskbot/shared";
import type { JobContext } from "../context";
import type { JobDeps } from "../deps";
import { formatTaskCard, showStatus, taskKeyboard } from "../telegram/messages";

export async function processNotification(
  data: NotificationJob,
  ctx: JobContext,
  deps: JobDeps,
): Promise<{ messageId: number | null }> {
  const record = await deps.tasks.getRecord(data.taskId);
  if (!record) {
    ctx.log.warn({ taskId: data.taskId }, "task not found, skipping notification");
    return { messageId: null };
  }

  const keyboard = taskKeyboard(record.task, deps.appUrl);

  if (data.kind === "task_created") {
    const text = formatTaskCard(record.task, { header: "Task created", timeZone: deps.timeZone });
    const messageId = await showStatus(
      deps.telegram,
      data.chatId,
      data.statusMessageId,
      text,
      keyboard,
    );
    if (messageId !== record.cardMessageId) {
      await deps.tasks.setCardMessageId(record.task.id, messageId);
    }
    return { messageId };
  }

  // Status changed on the dashboard: keep the card in Telegram in sync.
  if (!record.cardMessageId) return { messageId: null };
  await deps.telegram.editMessageText({
    chat_id: record.chatId,
    message_id: record.cardMessageId,
    text: formatTaskCard(record.task, { header: "Task updated", timeZone: deps.timeZone }),
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
  return { messageId: record.cardMessageId };
}
