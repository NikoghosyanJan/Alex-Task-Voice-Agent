import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_STATUSES,
  TelegramApiError,
  type InlineKeyboardButton,
  type InlineKeyboardMarkup,
  type TaskDTO,
  type TaskStatusValue,
  type TelegramClient,
} from "@taskbot/shared";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function preview(text: string, max: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}

const STATUS_CODE: Record<TaskStatusValue, string> = {
  PENDING: "P",
  IN_PROGRESS: "I",
  COMPLETED: "C",
};

const ACTION_LABEL: Record<TaskStatusValue, string> = {
  PENDING: "Reopen",
  IN_PROGRESS: "Start",
  COMPLETED: "Done",
};

/** Telegram limits callback_data to 64 bytes: "st:<cuid>:<code>" stays well under. */
export function statusCallbackData(taskId: string, status: TaskStatusValue): string {
  return `st:${taskId}:${STATUS_CODE[status]}`;
}

export function parseStatusCallback(
  data: string | undefined,
): { taskId: string; status: TaskStatusValue } | null {
  const match = /^st:([\w-]+):([PIC])$/.exec(data ?? "");
  if (!match) return null;
  const status = TASK_STATUSES.find((s) => STATUS_CODE[s] === match[2]);
  return status && match[1] ? { taskId: match[1], status } : null;
}

export function formatDueDate(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatTaskCard(
  task: TaskDTO,
  { header, timeZone }: { header: string; timeZone: string },
): string {
  const lines = [`<b>${escapeHtml(header)}</b>`, "", `<b>${escapeHtml(task.title)}</b>`];
  if (task.description) lines.push(escapeHtml(task.description));
  lines.push("");
  lines.push(`Status: ${STATUS_LABELS[task.status]}`);
  lines.push(`Priority: ${PRIORITY_LABELS[task.priority]}`);
  const due = formatDueDate(task.dueDate, timeZone);
  if (due) lines.push(`Due: ${escapeHtml(due)}`);
  if (task.source === "VOICE" && task.transcript) {
    lines.push("", `<i>Heard: "${escapeHtml(preview(task.transcript, 300))}"</i>`);
  }
  return lines.join("\n");
}

export function taskKeyboard(task: TaskDTO, appUrl: string): InlineKeyboardMarkup {
  const statusButtons: InlineKeyboardButton[] = TASK_STATUSES.filter((s) => s !== task.status).map(
    (status) => ({
      text: ACTION_LABEL[status],
      callback_data: statusCallbackData(task.id, status),
    }),
  );
  const rows: InlineKeyboardButton[][] = [statusButtons];
  // Telegram rejects URL buttons pointing at localhost / plain http.
  if (appUrl.startsWith("https://")) {
    rows.push([{ text: "Open dashboard", url: appUrl }]);
  }
  return { inline_keyboard: rows };
}

export const messages = {
  creatingTask: () => "Got it. Creating your task...",
  transcribing: () => "Got it. Transcribing your voice message...",
  transcribed: (transcript: string) =>
    `<b>Transcribed:</b>\n<i>"${escapeHtml(preview(transcript, 1_000))}"</i>\n\nCreating your task...`,
  voiceFailed: (reason: string) =>
    `<b>Couldn't process the voice message.</b>\n${escapeHtml(reason)}\nPlease try again or send the task as text.`,
  taskFailed: (reason: string) =>
    `<b>Couldn't create the task.</b>\n${escapeHtml(reason)}\nPlease try again in a moment.`,
};

/**
 * Edits the "working on it" message in place for a single evolving status line,
 * falling back to a new message if it can't be edited (deleted, too old, or never sent).
 */
export async function showStatus(
  telegram: Pick<TelegramClient, "sendMessage" | "editMessageText">,
  chatId: number,
  statusMessageId: number | null,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<number> {
  if (statusMessageId) {
    try {
      await telegram.editMessageText({
        chat_id: chatId,
        message_id: statusMessageId,
        text,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      });
      return statusMessageId;
    } catch (err) {
      if (!(err instanceof TelegramApiError) || err.status !== 400) throw err;
    }
  }
  const sent = await telegram.sendMessage({
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: replyMarkup,
  });
  return sent.message_id;
}
