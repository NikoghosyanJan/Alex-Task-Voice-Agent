import {
  deserializeChanges,
  escapeHtml,
  formatDueDate,
  formatProposal,
  formatTaskCard,
  MAX_AUDIO_BYTES,
  MAX_VOICE_SECONDS,
  messages,
  PROPOSAL_HEADERS,
  taskKeyboard,
  type CreateTelegramTaskInput,
  type PendingAction,
  type TaskRecord,
  type TelegramUserInput,
} from "@taskbot/jobs";
import {
  errorDetails,
  formatTaskNumber,
  parseDate,
  QueueName,
  STATUS_LABELS,
  type Enqueue,
  type Logger,
  type TaskChanges,
  type TaskDTO,
  type TelegramClient,
  type TgCallbackQuery,
  type TgMessage,
  type TgUpdate,
} from "@taskbot/shared";
import { classifyUpdate, type BotCommand, type UpdateAction } from "./router";

export const MAX_TEXT_LENGTH = 4_000;

export interface WebhookDeps {
  telegram: Pick<
    TelegramClient,
    "sendMessage" | "editMessageText" | "editMessageReplyMarkup" | "answerCallbackQuery"
  >;
  users: { upsert(input: TelegramUserInput): Promise<{ id: string }> };
  tasks: {
    getRecord(id: string): Promise<TaskRecord | null>;
    update(id: string, changes: TaskChanges): Promise<TaskRecord | null>;
    createFromTelegram(
      input: CreateTelegramTaskInput,
    ): Promise<{ record: TaskRecord; created: boolean }>;
    setCardMessageId(id: string, messageId: number): Promise<void>;
    recentForUser(telegramId: number, limit: number): Promise<TaskDTO[]>;
  };
  actions: {
    get(id: string): Promise<PendingAction | null>;
    delete(id: string): Promise<void>;
  };
  enqueue: Enqueue;
  appUrl: string;
  timeZone: string;
  log: Logger;
}

export interface HandleResult {
  action: UpdateAction["kind"];
  /** True when a job was queued, i.e. a drain should be triggered. */
  enqueued: boolean;
}

/** Immediate acknowledgement shown while the job is queued; null if Telegram couldn't be reached. */
async function replyStatus(
  deps: WebhookDeps,
  message: TgMessage,
  text: string,
): Promise<number | null> {
  try {
    const sent = await deps.telegram.sendMessage({
      chat_id: message.chat.id,
      text,
      parse_mode: "HTML",
      reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
    });
    return sent.message_id;
  } catch (err) {
    deps.log.warn({ err: errorDetails(err) }, "could not send status reply");
    return null;
  }
}

async function reply(deps: WebhookDeps, message: TgMessage, text: string): Promise<void> {
  await deps.telegram.sendMessage({ chat_id: message.chat.id, text, parse_mode: "HTML" });
}

function helpText(firstName: string | undefined, appUrl: string): string {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)}!` : "Hi!";
  return [
    `<b>${greeting} I turn your messages into tasks.</b>`,
    "",
    "Send me a text or a voice message, for example:",
    '<i>"Call the dentist tomorrow at 10, it\'s urgent"</i>',
    "",
    "You can also change your tasks by number or by name:",
    '<i>"Put task 5 in progress"</i>',
    '<i>"Make the dentist task high priority and move it to Friday"</i>',
    'Reply to a task card with <i>"mark this as done"</i> to change that task.',
    "",
    "I'll show you what I'm planning to do, and nothing changes until you press <b>Confirm</b>.",
    "",
    "/tasks - your latest tasks",
    "/dashboard - open the live board",
    "/help - show this message",
    "",
    `Dashboard: ${escapeHtml(appUrl)}`,
  ].join("\n");
}

function recentTasksText(tasks: TaskDTO[], timeZone: string): string {
  if (tasks.length === 0)
    return "You don't have any tasks yet. Send me a text or voice message to create one.";
  const lines = tasks.map((task) => {
    const due = formatDueDate(task.dueDate, timeZone);
    return `• ${formatTaskNumber(task.number)} [${STATUS_LABELS[task.status]}] ${escapeHtml(task.title)}${due ? ` (due ${escapeHtml(due)})` : ""}`;
  });
  return [`<b>Your latest ${tasks.length} tasks</b>`, "", ...lines].join("\n");
}

async function handleCommand(
  command: BotCommand,
  message: TgMessage,
  firstName: string | undefined,
  deps: WebhookDeps,
): Promise<void> {
  switch (command) {
    case "tasks": {
      const tasks = await deps.tasks.recentForUser(message.from?.id ?? message.chat.id, 10);
      await reply(deps, message, recentTasksText(tasks, deps.timeZone));
      return;
    }
    case "dashboard":
      await reply(deps, message, `Live dashboard: ${escapeHtml(deps.appUrl)}`);
      return;
    default:
      await reply(deps, message, helpText(firstName, deps.appUrl));
  }
}

export async function handleUpdate(update: TgUpdate, deps: WebhookDeps): Promise<HandleResult> {
  const action = classifyUpdate(update);
  const updateId = update.update_id;

  switch (action.kind) {
    case "ignore":
      return { action: action.kind, enqueued: false };

    case "command":
      await handleCommand(action.command, action.message, action.from.first_name, deps);
      return { action: action.kind, enqueued: false };

    case "unsupported":
      await reply(
        deps,
        action.message,
        "I can turn <b>text</b> and <b>voice</b> messages into tasks. Send me one!",
      );
      return { action: action.kind, enqueued: false };

    case "text": {
      if (action.text.length > MAX_TEXT_LENGTH) {
        await reply(
          deps,
          action.message,
          `That message is too long. Please keep tasks under ${MAX_TEXT_LENGTH} characters.`,
        );
        return { action: action.kind, enqueued: false };
      }
      const user = await deps.users.upsert({
        telegramId: action.from.id,
        chatId: action.message.chat.id,
        username: action.from.username,
        firstName: action.from.first_name,
      });
      const statusMessageId = await replyStatus(deps, action.message, messages.thinking());
      await deps.enqueue(
        QueueName.TaskProcessing,
        {
          updateId,
          chatId: action.message.chat.id,
          userId: user.id,
          telegramUserId: action.from.id,
          replyToText: action.replyToText,
          statusMessageId,
          source: "TEXT",
          text: action.text,
        },
        { jobId: `task-${updateId}` },
      );
      return { action: action.kind, enqueued: true };
    }

    case "audio": {
      const { media, message, from } = action;
      if (media.durationSec > MAX_VOICE_SECONDS) {
        await reply(
          deps,
          message,
          `That recording is too long. Voice tasks can be up to ${MAX_VOICE_SECONDS / 60} minutes.`,
        );
        return { action: action.kind, enqueued: false };
      }
      if ((media.fileSize ?? 0) > MAX_AUDIO_BYTES) {
        await reply(
          deps,
          message,
          "That file is too large. Telegram bots can only download files up to 20 MB.",
        );
        return { action: action.kind, enqueued: false };
      }
      const user = await deps.users.upsert({
        telegramId: from.id,
        chatId: message.chat.id,
        username: from.username,
        firstName: from.first_name,
      });
      const statusMessageId = await replyStatus(deps, message, messages.transcribing());
      await deps.enqueue(
        QueueName.Transcription,
        {
          updateId,
          chatId: message.chat.id,
          userId: user.id,
          telegramUserId: from.id,
          replyToText: action.replyToText,
          messageId: message.message_id,
          statusMessageId,
          fileId: media.fileId,
          durationSec: media.durationSec,
          mimeType: media.mimeType,
          kind: media.kind,
        },
        { jobId: `voice-${updateId}` },
      );
      return { action: action.kind, enqueued: true };
    }

    case "unknown_callback":
      await deps.telegram.answerCallbackQuery(action.callback.id);
      return { action: action.kind, enqueued: false };

    case "status_callback": {
      const { callback, taskId, status } = action;
      const record = await deps.tasks.getRecord(taskId);
      if (!record) {
        await deps.telegram.answerCallbackQuery(callback.id, "This task no longer exists.");
        return { action: action.kind, enqueued: false };
      }
      if (record.ownerTelegramId !== callback.from.id) {
        await deps.telegram.answerCallbackQuery(
          callback.id,
          "Only the task owner can change its status.",
        );
        return { action: action.kind, enqueued: false };
      }

      const updated =
        record.task.status === status ? record : await deps.tasks.update(taskId, { status });
      if (!updated) {
        await deps.telegram.answerCallbackQuery(callback.id, "This task no longer exists.");
        return { action: action.kind, enqueued: false };
      }
      await deps.telegram.answerCallbackQuery(callback.id, `Marked as ${STATUS_LABELS[status]}`);

      if (callback.message) {
        await deps.telegram.editMessageText({
          chat_id: callback.message.chat.id,
          message_id: callback.message.message_id,
          text: formatTaskCard(updated.task, { header: "Task updated", timeZone: deps.timeZone }),
          parse_mode: "HTML",
          reply_markup: taskKeyboard(updated.task, deps.appUrl),
        });
      }
      return { action: action.kind, enqueued: false };
    }

    case "action_callback":
      return {
        action: action.kind,
        enqueued: await handleActionCallback(
          action.callback,
          action.actionId,
          action.confirmed,
          deps,
        ),
      };
  }
}

/** Carries out the confirmed plan; a retried update is harmless (creation is idempotent per update id). */
async function executeAction(action: PendingAction, deps: WebhookDeps): Promise<TaskRecord | null> {
  if (action.kind === "create") {
    const { record } = await deps.tasks.createFromTelegram({
      ...action.task,
      dueDate: action.task.dueDate ? parseDate(action.task.dueDate) : null,
      userId: action.userId,
      updateId: action.updateId,
      source: action.source,
      originalText: action.originalText,
      transcript: action.transcript,
    });
    return record;
  }
  return deps.tasks.update(action.taskId, deserializeChanges(action.changes));
}

/** Confirm / Cancel on a proposal. Returns true when a job was queued. */
async function handleActionCallback(
  callback: TgCallbackQuery,
  actionId: string,
  confirmed: boolean,
  deps: WebhookDeps,
): Promise<boolean> {
  const message = callback.message;
  const target = message ? { chat_id: message.chat.id, message_id: message.message_id } : null;

  const action = await deps.actions.get(actionId);
  if (!action) {
    await deps.telegram.answerCallbackQuery(callback.id, PROPOSAL_HEADERS.expired);
    if (target) await deps.telegram.editMessageReplyMarkup(target);
    return false;
  }
  if (action.telegramUserId !== callback.from.id) {
    await deps.telegram.answerCallbackQuery(
      callback.id,
      "Only the person who sent this request can confirm it.",
    );
    return false;
  }

  if (!confirmed) {
    await deps.telegram.answerCallbackQuery(callback.id, "Cancelled");
    if (target) {
      await deps.telegram.editMessageText({
        ...target,
        text: formatProposal(action, {
          header: PROPOSAL_HEADERS.cancelled,
          timeZone: deps.timeZone,
        }),
        parse_mode: "HTML",
      });
    }
    await deps.actions.delete(actionId);
    return false;
  }

  const record = await executeAction(action, deps);
  if (!record) {
    await deps.telegram.answerCallbackQuery(callback.id, "This task no longer exists.");
    if (target) await deps.telegram.editMessageReplyMarkup(target);
    await deps.actions.delete(actionId);
    return false;
  }

  const header = action.kind === "create" ? "Task created" : "Task updated";
  await deps.telegram.answerCallbackQuery(callback.id, header);
  if (target) {
    await deps.telegram.editMessageText({
      ...target,
      text: formatTaskCard(record.task, { header, timeZone: deps.timeZone }),
      parse_mode: "HTML",
      reply_markup: taskKeyboard(record.task, deps.appUrl),
    });
    if (action.kind === "create") {
      await deps.tasks.setCardMessageId(record.task.id, target.message_id);
    }
  }
  await deps.actions.delete(actionId);

  // The task's original card lives in another message: keep it in sync too.
  if (
    action.kind === "update" &&
    record.cardMessageId &&
    record.cardMessageId !== target?.message_id
  ) {
    try {
      await deps.enqueue(QueueName.Notifications, { kind: "task_updated", taskId: record.task.id });
      return true;
    } catch (err) {
      deps.log.warn(
        { taskId: record.task.id, err: errorDetails(err) },
        "could not enqueue card sync",
      );
    }
  }
  return false;
}
