import type { NotificationJob } from "@taskbot/shared";
import type { JobContext } from "../context";
import type { JobDeps } from "../deps";
import {
  escapeHtml,
  formatDeletedCard,
  formatProposal,
  formatTaskCard,
  PROPOSAL_HEADERS,
  proposalKeyboard,
  showStatus,
  taskKeyboard,
} from "../telegram/messages";

export async function processNotification(
  data: NotificationJob,
  ctx: JobContext,
  deps: JobDeps,
): Promise<{ messageId: number | null }> {
  switch (data.kind) {
    case "action_proposed": {
      const action = await deps.actions.get(data.actionId);
      if (!action) {
        ctx.log.warn({ actionId: data.actionId }, "pending action not found, skipping proposal");
        return { messageId: null };
      }
      const messageId = await showStatus(
        deps.telegram,
        data.chatId,
        data.statusMessageId,
        formatProposal(action, { header: PROPOSAL_HEADERS.pending, timeZone: deps.timeZone }),
        proposalKeyboard(action.id),
      );
      return { messageId };
    }

    case "reply": {
      const messageId = await showStatus(
        deps.telegram,
        data.chatId,
        data.statusMessageId,
        escapeHtml(data.text),
      );
      return { messageId };
    }

    case "task_updated": {
      const record = await deps.tasks.getRecord(data.taskId);
      if (!record) {
        ctx.log.warn({ taskId: data.taskId }, "task not found, skipping card sync");
        return { messageId: null };
      }
      if (!record.cardMessageId) return { messageId: null };
      await deps.telegram.editMessageText({
        chat_id: record.chatId,
        message_id: record.cardMessageId,
        text: formatTaskCard(record.task, { header: "Task updated", timeZone: deps.timeZone }),
        parse_mode: "HTML",
        reply_markup: taskKeyboard(record.task, deps.appUrl),
      });
      return { messageId: record.cardMessageId };
    }

    case "task_deleted": {
      // No reply_markup: the status buttons are removed along with the task.
      await deps.telegram.editMessageText({
        chat_id: data.chatId,
        message_id: data.messageId,
        text: formatDeletedCard(data),
        parse_mode: "HTML",
      });
      return { messageId: data.messageId };
    }
  }
}
