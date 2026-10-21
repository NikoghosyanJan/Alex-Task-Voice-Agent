import { describe, expect, it, vi } from "vitest";
import { logger, type TgUpdate } from "@taskbot/shared";
import type { PendingAction, TaskRecord } from "@taskbot/jobs";
import { handleUpdate, type WebhookDeps } from "./handleUpdate";

const from = { id: 777, is_bot: false, first_name: "Zhanna", username: "zhanna" };
const chat = { id: 777, type: "private" as const };

function record(status: TaskRecord["task"]["status"] = "PENDING", owner = 777): TaskRecord {
  return {
    task: {
      id: "task_1",
      number: 1,
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
      editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
      answerCallbackQuery: vi.fn().mockResolvedValue(true),
    },
    users: { upsert: vi.fn().mockResolvedValue({ id: "user_1" }) },
    tasks: {
      getRecord: vi.fn().mockResolvedValue(record()),
      update: vi.fn().mockResolvedValue(record("COMPLETED")),
      delete: vi.fn<WebhookDeps["tasks"]["delete"]>().mockResolvedValue(record()),
      createFromTelegram: vi.fn().mockResolvedValue({ record: record(), created: true }),
      setCardMessageId: vi.fn().mockResolvedValue(undefined),
      recentForUser: vi.fn().mockResolvedValue([]),
    },
    actions: {
      get: vi.fn<WebhookDeps["actions"]["get"]>().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
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
        telegramUserId: 777,
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
    expect(deps.tasks.update).toHaveBeenCalledWith("task_1", { status: "COMPLETED" });
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
    expect(deps.tasks.update).not.toHaveBeenCalled();
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
    expect(deps.telegram.sendMessage.mock.calls[0]?.[0].text).toContain("#01 [Pending] Buy milk");
  });

  it("passes the replied-to message along so 'this task' can be resolved", async () => {
    const deps = makeDeps();
    await handleUpdate(
      {
        update_id: 48,
        message: {
          message_id: 2,
          date: 0,
          chat,
          from,
          text: "mark this as done",
          reply_to_message: {
            message_id: 55,
            date: 0,
            chat,
            text: "Task created\n\n#01 · Buy milk",
          },
        },
      },
      deps,
    );
    expect(deps.enqueue).toHaveBeenCalledWith(
      "task-processing",
      expect.objectContaining({ replyToText: "Task created\n\n#01 · Buy milk" }),
      { jobId: "task-48" },
    );
  });
});

describe("confirming planned actions", () => {
  const common = { id: "42", telegramUserId: 777, userId: "user_1", chatId: 777, transcript: null };
  const createAction: PendingAction = {
    ...common,
    kind: "create",
    updateId: 42,
    source: "TEXT",
    originalText: "buy milk",
    task: {
      title: "Buy milk",
      description: null,
      priority: "HIGH",
      dueDate: "2026-10-22T14:00:00.000Z",
    },
  };
  const updateAction: PendingAction = {
    ...common,
    kind: "update",
    taskId: "task_1",
    before: {
      number: 1,
      title: "Buy milk",
      description: null,
      priority: "MEDIUM",
      dueDate: null,
      status: "PENDING",
    },
    changes: { status: "COMPLETED", dueDate: null },
  };
  const press = (data: string, userId = 777): TgUpdate => ({
    update_id: 90,
    callback_query: {
      id: "cb",
      from: { ...from, id: userId },
      data,
      message: { message_id: 321, date: 0, chat },
    },
  });

  it("creates the task on Confirm and turns the proposal into its card", async () => {
    const deps = makeDeps();
    deps.actions.get.mockResolvedValue(createAction);
    await expect(handleUpdate(press("ac:42:y"), deps)).resolves.toEqual({
      action: "action_callback",
      enqueued: false,
    });

    expect(deps.tasks.createFromTelegram).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Buy milk",
        priority: "HIGH",
        dueDate: new Date("2026-10-22T14:00:00.000Z"),
        updateId: 42,
        userId: "user_1",
      }),
    );
    expect(deps.telegram.answerCallbackQuery).toHaveBeenCalledWith("cb", "Task created");
    expect(deps.telegram.editMessageText).toHaveBeenCalledWith(
      expect.objectContaining({ message_id: 321, text: expect.stringContaining("Task created") }),
    );
    expect(deps.tasks.setCardMessageId).toHaveBeenCalledWith("task_1", 321);
    expect(deps.actions.delete).toHaveBeenCalledWith("42");
  });

  it("applies the planned changes on Confirm and syncs the task's original card", async () => {
    const deps = makeDeps();
    deps.actions.get.mockResolvedValue(updateAction);
    deps.tasks.update.mockResolvedValue({ ...record("COMPLETED"), cardMessageId: 55 });
    await expect(handleUpdate(press("ac:42:y"), deps)).resolves.toEqual({
      action: "action_callback",
      enqueued: true,
    });

    expect(deps.tasks.update).toHaveBeenCalledWith("task_1", {
      status: "COMPLETED",
      dueDate: null,
    });
    expect(deps.telegram.editMessageText).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: 321,
        text: expect.stringContaining("Status: Completed"),
      }),
    );
    expect(deps.enqueue).toHaveBeenCalledWith("notifications", {
      kind: "task_updated",
      taskId: "task_1",
    });
  });

  it("deletes the task on Confirm and marks its original card as deleted", async () => {
    const deps = makeDeps();
    deps.actions.get.mockResolvedValue({
      ...common,
      kind: "delete",
      taskId: "task_1",
      before: updateAction.before,
    });
    await expect(handleUpdate(press("ac:42:y"), deps)).resolves.toEqual({
      action: "action_callback",
      enqueued: true,
    });

    expect(deps.tasks.delete).toHaveBeenCalledWith("task_1");
    expect(deps.telegram.answerCallbackQuery).toHaveBeenCalledWith("cb", "Task deleted");
    const edit = deps.telegram.editMessageText.mock.calls[0]?.[0];
    expect(edit).toMatchObject({
      message_id: 321,
      text: expect.stringContaining("<s>#01 · Buy milk</s>"),
    });
    expect(edit?.reply_markup).toBeUndefined();
    expect(deps.enqueue).toHaveBeenCalledWith("notifications", {
      kind: "task_deleted",
      chatId: 777,
      messageId: 55,
      number: 1,
      title: "Buy milk",
    });
    expect(deps.actions.delete).toHaveBeenCalledWith("42");
  });

  it("treats a task that's already gone as deleted", async () => {
    const deps = makeDeps();
    deps.actions.get.mockResolvedValue({
      ...common,
      kind: "delete",
      taskId: "task_1",
      before: updateAction.before,
    });
    deps.tasks.delete.mockResolvedValue(null);
    await expect(handleUpdate(press("ac:42:y"), deps)).resolves.toMatchObject({ enqueued: false });
    expect(deps.telegram.editMessageText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("Task deleted") }),
    );
  });

  it("changes nothing on Cancel", async () => {
    const deps = makeDeps();
    deps.actions.get.mockResolvedValue(updateAction);
    await handleUpdate(press("ac:42:n"), deps);

    expect(deps.tasks.update).not.toHaveBeenCalled();
    expect(deps.telegram.editMessageText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("Cancelled. Nothing was changed.") }),
    );
    expect(deps.actions.delete).toHaveBeenCalledWith("42");
  });

  it("only lets the requester confirm", async () => {
    const deps = makeDeps();
    deps.actions.get.mockResolvedValue(updateAction);
    await handleUpdate(press("ac:42:y", 111), deps);

    expect(deps.tasks.update).not.toHaveBeenCalled();
    expect(deps.actions.delete).not.toHaveBeenCalled();
    expect(deps.telegram.answerCallbackQuery).toHaveBeenCalledWith(
      "cb",
      expect.stringContaining("Only the person"),
    );
  });

  it("removes the buttons from an expired proposal", async () => {
    const deps = makeDeps();
    await handleUpdate(press("ac:42:y"), deps);

    expect(deps.tasks.createFromTelegram).not.toHaveBeenCalled();
    expect(deps.telegram.answerCallbackQuery).toHaveBeenCalledWith(
      "cb",
      expect.stringContaining("expired"),
    );
    expect(deps.telegram.editMessageReplyMarkup).toHaveBeenCalledWith({
      chat_id: 777,
      message_id: 321,
    });
  });
});
