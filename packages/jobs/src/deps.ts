import {
  enqueue,
  getAppUrl,
  getTelegram,
  getTimeZone,
  logger,
  structureTask,
  transcribeAudio,
  type Enqueue,
  type Logger,
  type StructuredTask,
  type TelegramClient,
  type TranscribeOptions,
} from "@taskbot/shared";
import {
  createTaskFromTelegram,
  getTaskRecord,
  setCardMessageId,
  type CreateTelegramTaskInput,
  type TaskRecord,
} from "./services/taskService";

/** Everything processors touch, injectable so they can be unit-tested without Redis/DB/APIs. */
export interface JobDeps {
  telegram: Pick<TelegramClient, "getFile" | "downloadFile" | "sendMessage" | "editMessageText">;
  ai: {
    transcribe(audio: Buffer, options: TranscribeOptions): Promise<string>;
    structure(text: string): Promise<StructuredTask>;
  };
  tasks: {
    createFromTelegram(
      input: CreateTelegramTaskInput,
    ): Promise<{ record: TaskRecord; created: boolean }>;
    getRecord(id: string): Promise<TaskRecord | null>;
    setCardMessageId(id: string, messageId: number): Promise<void>;
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
      structure: (text) => structureTask(text, { timeZone }),
    },
    tasks: {
      createFromTelegram: createTaskFromTelegram,
      getRecord: getTaskRecord,
      setCardMessageId,
    },
    enqueue,
    appUrl: getAppUrl(),
    timeZone,
    log: logger,
  };
}
