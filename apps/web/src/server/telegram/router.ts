import { parseActionCallback, parseStatusCallback } from "@taskbot/jobs";
import type {
  TaskStatusValue,
  TgCallbackQuery,
  TgMessage,
  TgUpdate,
  TgUser,
} from "@taskbot/shared";

export type BotCommand = "start" | "help" | "tasks" | "dashboard" | "unknown";

export interface AudioMedia {
  kind: "voice" | "audio";
  fileId: string;
  durationSec: number;
  fileSize?: number;
  mimeType?: string;
}

export type UpdateAction =
  | { kind: "command"; command: BotCommand; message: TgMessage; from: TgUser }
  | { kind: "text"; text: string; replyToText?: string; message: TgMessage; from: TgUser }
  | { kind: "audio"; media: AudioMedia; replyToText?: string; message: TgMessage; from: TgUser }
  | { kind: "status_callback"; taskId: string; status: TaskStatusValue; callback: TgCallbackQuery }
  | { kind: "action_callback"; actionId: string; confirmed: boolean; callback: TgCallbackQuery }
  | { kind: "unknown_callback"; callback: TgCallbackQuery }
  | { kind: "unsupported"; message: TgMessage }
  | { kind: "ignore" };

const KNOWN_COMMANDS = new Set<BotCommand>(["start", "help", "tasks", "dashboard"]);

export function parseCommand(text: string): BotCommand | null {
  const match = /^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i.exec(text.trim());
  if (!match || !match[1]) return null;
  const command = match[1].toLowerCase() as BotCommand;
  return KNOWN_COMMANDS.has(command) ? command : "unknown";
}

/** Pure routing decision for an incoming update; side effects live in handleUpdate. */
export function classifyUpdate(update: TgUpdate): UpdateAction {
  if (update.callback_query) {
    const callback = update.callback_query;
    const status = parseStatusCallback(callback.data);
    if (status) return { kind: "status_callback", ...status, callback };
    const action = parseActionCallback(callback.data);
    if (action) return { kind: "action_callback", ...action, callback };
    return { kind: "unknown_callback", callback };
  }

  const message = update.message;
  if (!message || !message.from || message.from.is_bot) return { kind: "ignore" };
  const from = message.from;
  const reply = message.reply_to_message;
  const replyToText = (reply?.text ?? reply?.caption)?.trim() || undefined;

  if (message.voice) {
    const { file_id, duration, file_size, mime_type } = message.voice;
    return {
      kind: "audio",
      media: {
        kind: "voice",
        fileId: file_id,
        durationSec: duration,
        fileSize: file_size,
        mimeType: mime_type,
      },
      replyToText,
      message,
      from,
    };
  }

  if (message.audio) {
    const { file_id, duration, file_size, mime_type } = message.audio;
    if (mime_type && !mime_type.startsWith("audio/")) return { kind: "unsupported", message };
    return {
      kind: "audio",
      media: {
        kind: "audio",
        fileId: file_id,
        durationSec: duration,
        fileSize: file_size,
        mimeType: mime_type,
      },
      replyToText,
      message,
      from,
    };
  }

  const text = message.text?.trim();
  if (text) {
    const command = parseCommand(text);
    if (command) return { kind: "command", command, message, from };
    return { kind: "text", text, replyToText, message, from };
  }

  return { kind: "unsupported", message };
}
