import {
  enqueue,
  getAppUrl,
  getTelegram,
  getTimeZone,
  interpretMessage,
  logger,
  transcribeAudio,
  type Enqueue,
  type Logger,
  type MessagePlan,
  type TaskContext,
  type TaskDTO,
  type TelegramClient,
  type TranscribeOptions,
} from "@taskbot/shared";
import { getPendingAction, savePendingAction, type PendingAction } from "./actions/pendingActions";
import {
  getTaskRecord,
  listRecentTasksForTelegramUser,
  type TaskRecord,
} from "./services/taskService";

/** Everything processors touch, injectable so they can be unit-tested without Redis/DB/APIs. */
export interface JobDeps {
  telegram: Pick<TelegramClient, "getFile" | "downloadFile" | "sendMessage" | "editMessageText">;
  ai: {
    transcribe(audio: Buffer, options: TranscribeOptions): Promise<string>;
    interpret(
      text: string,
      context: { tasks: TaskContext[]; replyTo?: string },
    ): Promise<MessagePlan>;
  };
  tasks: {
    listForTelegramUser(telegramId: number, limit: number): Promise<TaskDTO[]>;
    getRecord(id: string): Promise<TaskRecord | null>;
  };
  actions: {
    save(action: PendingAction): Promise<void>;
    get(id: string): Promise<PendingAction | null>;
  };
  enqueue: Enqueue;
  appUrl: string;
  timeZone: string;
  log: Logger;
}

export function createDefaultDeps(): JobDeps {
  const timeZone = getTimeZone();
  return {
    telegram: getTelegram(),
    ai: {
      transcribe: transcribeAudio,
      interpret: (text, context) => interpretMessage(text, { ...context, timeZone }),
    },
    tasks: {
      listForTelegramUser: listRecentTasksForTelegramUser,
      getRecord: getTaskRecord,
    },
    actions: { save: savePendingAction, get: getPendingAction },
    enqueue,
    appUrl: getAppUrl(),
    timeZone,
    log: logger,
  };
}
