import { vi } from "vitest";
import { logger, type TaskDTO } from "@taskbot/shared";
import type { JobDeps } from "./deps";
import type { TaskRecord } from "./services/taskService";

export const silentLogger = logger.child({}, { level: "silent" });

export function makeTask(overrides: Partial<TaskDTO> = {}): TaskDTO {
  return {
    id: "task_1",
    title: "Buy milk",
    description: null,
    status: "PENDING",
    priority: "MEDIUM",
    dueDate: null,
    source: "TEXT",
    originalText: "buy milk",
    transcript: null,
    createdAt: "2026-10-21T05:00:00.000Z",
    updatedAt: "2026-10-21T05:00:00.000Z",
    author: { username: "zhanna", firstName: "Zhanna" },
    ...overrides,
  };
}

export function makeRecord(
  overrides: Partial<TaskDTO> = {},
  cardMessageId: number | null = null,
): TaskRecord {
  return { task: makeTask(overrides), chatId: 777, ownerTelegramId: 777, cardMessageId };
}

export function makeDeps() {
  const deps = {
    telegram: {
      getFile: vi
        .fn()
        .mockResolvedValue({
          file_id: "F",
          file_unique_id: "U",
          file_size: 1024,
          file_path: "voice/file_1.oga",
        }),
      downloadFile: vi.fn().mockResolvedValue(Buffer.alloc(1024)),
      sendMessage: vi.fn().mockResolvedValue({ message_id: 500 }),
      editMessageText: vi.fn().mockResolvedValue(null),
    },
    ai: {
      transcribe: vi.fn().mockResolvedValue("buy milk tomorrow"),
      structure: vi
        .fn()
        .mockResolvedValue({
          title: "Buy milk",
          description: null,
          priority: "HIGH",
          dueDate: null,
        }),
    },
    tasks: {
      createFromTelegram: vi.fn().mockResolvedValue({ record: makeRecord(), created: true }),
      getRecord: vi.fn().mockResolvedValue(makeRecord()),
      setCardMessageId: vi.fn().mockResolvedValue(undefined),
    },
    enqueue: vi.fn().mockResolvedValue("job-id"),
    appUrl: "https://taskbot.example.com",
    timeZone: "UTC",
    log: silentLogger,
  };
  return deps satisfies JobDeps;
}
