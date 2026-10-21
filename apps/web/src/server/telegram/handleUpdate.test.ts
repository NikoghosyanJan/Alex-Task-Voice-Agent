import { describe, expect, it, vi } from "vitest";
import { logger, type TgUpdate } from "@taskbot/shared";
import type { TaskRecord } from "@taskbot/jobs";
import { handleUpdate, type WebhookDeps } from "./handleUpdate";

const from = { id: 777, is_bot: false, first_name: "Zhanna", username: "zhanna" };
const chat = { id: 777, type: "private" as const };

function record(status: TaskRecord["task"]["status"] = "PENDING", owner = 777): TaskRecord {
  return {
    task: {
      id: "task_1",
      title: "Buy milk",
      description: null,
      status,
      priority: "MEDIUM",
      dueDate: null,
      source: "TEXT",
      originalText: "buy milk",
      transcript: null,
      createdAt: "2026-10-21T05:00:00.000Z",
      updatedAt: "2026-10-21T05:00:00.000Z",
      author: { username: "zhanna", firstName: "Zhanna" },
    },
    chatId: 777,
    ownerTelegramId: owner,
    cardMessageId: 55,
  };
}

function makeDeps() {
  return {
    telegram: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 321 }),
      editMessageText: vi.fn().mockResolvedValue(null),
      answerCallbackQuery: vi.fn().mockResolvedValue(true),
    },
    users: { upsert: vi.fn().mockResolvedValue({ id: "user_1" }) },
    tasks: {
      getRecord: vi.fn().mockResolvedValue(record()),
      updateStatus: vi.fn().mockResolvedValue(record("COMPLETED")),
      recentForUser: vi.fn().mockResolvedValue([]),
    },
    enqueue: vi.fn().mockResolvedValue("job"),
    appUrl: "https://taskbot.example.com",
    timeZone: "UTC",
    log: logger.child({}, { level: "silent" }),
  } satisfies WebhookDeps;
}

const textUpdate: TgUpdate = {
  update_id: 42,
  message: { message_id: 7, date: 0, chat, from, text: "Buy milk" },
};

describe("handleUpdate", () => {
  it("acknowledges text immediately and queues task processing", async () => {
    const deps = makeDeps();
    await expect(handleUpdate(textUpdate, deps)).resolves.toEqual({
      action: "text",
      enqueued: true,
    });

    expect(deps.telegram.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: 777,
        reply_parameters: expect.objectContaining({ message_id: 7 }),
      }),
    );
    expect(deps.enqueue).toHaveBeenCalledWith(
      "task-processing",
      {
        updateId: 42,
        chatId: 777,
        userId: "user_1",
        statusMessageId: 321,
        source: "TEXT",
        text: "Buy milk",
      },
      { jobId: "task-42" },
    );
  });

  it("still queues the task when the acknowledgement can't be sent", async () => {
    const deps = makeDeps();
    deps.telegram.sendMessage.mockRejectedValue(new Error("telegram down"));
    await handleUpdate(textUpdate, deps);
    expect(deps.enqueue).toHaveBeenCalledWith(
      "task-processing",
      expect.objectContaining({ statusMessageId: null }),
      {
        jobId: "task-42",
      },
    );
  });

  it("queues voice messages for transcription with an idempotent job id", async () => {
    const deps = makeDeps();
    const update: TgUpdate = {
      update_id: 43,
      message: {
        message_id: 8,
        date: 0,
        chat,
        from,
        voice: { file_id: "F", file_unique_id: "U", duration: 5, file_size: 999 },
      },
    };
    await expect(handleUpdate(update, deps)).resolves.toEqual({ action: "audio", enqueued: true });
    expect(deps.telegram.sendMessage.mock.calls[0]?.[0].text).toContain("Transcribing");
    expect(deps.enqueue).toHaveBeenCalledWith(
      "transcription",
      expect.objectContaining({ fileId: "F", durationSec: 5, statusMessageId: 321, kind: "voice" }),
      { jobId: "voice-43" },
    );
  });

  it("rejects overly long recordings without queueing", async () => {
    const deps = makeDeps();
    const update: TgUpdate = {
      update_id: 44,
      message: {
        message_id: 9,
        date: 0,
        chat,
        from,
        voice: { file_id: "F", file_unique_id: "U", duration: 3_600 },
      },
    };
    await expect(handleUpdate(update, deps)).resolves.toEqual({ action: "audio", enqueued: false });
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(deps.telegram.sendMessage.mock.calls[0]?.[0].text).toContain("too long");
  });

  it("updates status from an inline button and refreshes the card", async () => {
    const deps = makeDeps();
    const update: TgUpdate = {
      update_id: 45,
      callback_query: {
        id: "cb",
        from,
        data: "st:task_1:C",
        message: { message_id: 55, date: 0, chat },
      },
    };
    await handleUpdate(update, deps);
    expect(deps.tasks.updateStatus).toHaveBeenCalledWith("task_1", "COMPLETED");
    expect(deps.telegram.answerCallbackQuery).toHaveBeenCalledWith("cb", "Marked as Completed");
    expect(deps.telegram.editMessageText).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: 55,
        text: expect.stringContaining("Status: Completed"),
      }),
    );
  });

  it("does not let other users change someone's task", async () => {
    const deps = makeDeps();
    deps.tasks.getRecord.mockResolvedValue(record("PENDING", 111));
    await handleUpdate(
      { update_id: 46, callback_query: { id: "cb", from, data: "st:task_1:C" } },
      deps,
    );
    expect(deps.tasks.updateStatus).not.toHaveBeenCalled();
    expect(deps.telegram.answerCallbackQuery).toHaveBeenCalledWith(
      "cb",
      expect.stringContaining("owner"),
    );
  });

  it("answers /tasks with the user's recent tasks", async () => {
    const deps = makeDeps();
    deps.tasks.recentForUser.mockResolvedValue([record().task]);
    await handleUpdate(
      { update_id: 47, message: { message_id: 1, date: 0, chat, from, text: "/tasks" } },
      deps,
    );
    expect(deps.tasks.recentForUser).toHaveBeenCalledWith(777, 10);
    expect(deps.telegram.sendMessage.mock.calls[0]?.[0].text).toContain("[Pending] Buy milk");
  });
});
