import { UnrecoverableError } from "bullmq";
import { describe, expect, it } from "vitest";
import { AppError, type InlineKeyboardButton } from "@taskbot/shared";
import { handleFinalFailure } from "../failure";
import { makeDeps, makeRecord, makeTask } from "../testUtils";
import { runJob } from "./index";

const voiceJob = {
  updateId: 10,
  chatId: 777,
  userId: "user_1",
  telegramUserId: 777,
  replyToText: "Task created\n\n#01 · Buy milk",
  messageId: 5,
  statusMessageId: 600,
  fileId: "FILE",
  durationSec: 4,
  kind: "voice" as const,
};

const textJob = {
  updateId: 11,
  chatId: 777,
  userId: "user_1",
  telegramUserId: 777,
  statusMessageId: 601,
  source: "TEXT" as const,
  text: "Buy milk tomorrow",
};

const attempt = (attemptsMade: number, attempts = 3) => ({ attemptsMade, opts: { attempts } });
const aiDown = () => new AppError("AI_UNAVAILABLE", "503 overloaded", { retryable: true });

describe("transcription processor", () => {
  it("downloads, transcribes, shows the transcript and queues task processing", async () => {
    const deps = makeDeps();
    await runJob("transcription", { id: "voice-10", data: voiceJob, ...attempt(0) }, deps);

    expect(deps.ai.transcribe).toHaveBeenCalledWith(expect.any(Buffer), {
      filename: "voice.ogg",
      mimeType: "audio/ogg",
    });
    expect(deps.telegram.editMessageText).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: 600,
        text: expect.stringContaining("buy milk tomorrow"),
      }),
    );
    expect(deps.enqueue).toHaveBeenCalledWith(
      "task-processing",
      expect.objectContaining({
        source: "VOICE",
        text: "buy milk tomorrow",
        transcript: "buy milk tomorrow",
        telegramUserId: 777,
        replyToText: voiceJob.replyToText,
      }),
      { jobId: "task-10" },
    );
  });

  it("fails permanently on an empty transcript", async () => {
    const deps = makeDeps();
    deps.ai.transcribe.mockResolvedValue("");
    const run = runJob("transcription", { id: "voice-10", data: voiceJob, ...attempt(0) }, deps);
    await expect(run).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(run).rejects.toThrow("[EMPTY_TRANSCRIPT]");
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it("retries when OpenAI is temporarily down", async () => {
    const deps = makeDeps();
    deps.ai.transcribe.mockRejectedValue(aiDown());
    const run = runJob("transcription", { id: "voice-10", data: voiceJob, ...attempt(0) }, deps);
    await expect(run).rejects.toThrow("[AI_UNAVAILABLE]");
    await expect(run).rejects.not.toBeInstanceOf(UnrecoverableError);
  });

  it("still queues the task if the progress message can't be updated", async () => {
    const deps = makeDeps();
    deps.telegram.editMessageText.mockRejectedValue(new Error("network down"));
    await runJob("transcription", { id: "voice-10", data: voiceJob, ...attempt(0) }, deps);
    expect(deps.enqueue).toHaveBeenCalledOnce();
  });
});

describe("task processing processor", () => {
  it("proposes a new task for confirmation without writing to the database", async () => {
    const deps = makeDeps();
    const result = await runJob(
      "task-processing",
      { id: "task-11", data: textJob, ...attempt(0) },
      deps,
    );

    expect(result).toEqual({ action: "create", actionId: "11", usedAi: true });
    expect(deps.tasks.listForTelegramUser).toHaveBeenCalledWith(777, 50);
    expect(deps.actions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "11",
        kind: "create",
        telegramUserId: 777,
        updateId: 11,
        originalText: "Buy milk tomorrow",
        task: { title: "Buy milk", description: null, priority: "HIGH", dueDate: null },
      }),
    );
    expect(deps.enqueue).toHaveBeenCalledWith(
      "notifications",
      { kind: "action_proposed", actionId: "11", chatId: 777, statusMessageId: 601 },
      { jobId: "notify-proposal-11" },
    );
  });

  it("proposes changes to an existing task with a snapshot of its current values", async () => {
    const deps = makeDeps();
    deps.tasks.listForTelegramUser.mockResolvedValue([
      makeTask({ id: "task_5", number: 5, title: "Call dentist" }),
    ]);
    deps.ai.interpret.mockResolvedValue({
      action: "update",
      taskNumber: 5,
      changes: { status: "IN_PROGRESS", dueDate: new Date("2026-10-23T14:00:00.000Z") },
    });
    await runJob(
      "task-processing",
      { id: "t", data: { ...textJob, text: "put task 5 in progress" }, ...attempt(0) },
      deps,
    );

    expect(deps.actions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "update",
        taskId: "task_5",
        before: expect.objectContaining({ number: 5, title: "Call dentist", status: "PENDING" }),
        changes: { status: "IN_PROGRESS", dueDate: "2026-10-23T14:00:00.000Z" },
      }),
    );
  });

  it("replies instead of proposing when the AI needs clarification", async () => {
    const deps = makeDeps();
    deps.ai.interpret.mockResolvedValue({ action: "clarify", message: "Which task? #01 or #02?" });
    await runJob("task-processing", { id: "t", data: textJob, ...attempt(0) }, deps);

    expect(deps.actions.save).not.toHaveBeenCalled();
    expect(deps.enqueue).toHaveBeenCalledWith(
      "notifications",
      { kind: "reply", chatId: 777, statusMessageId: 601, text: "Which task? #01 or #02?" },
      { jobId: "notify-reply-11" },
    );
  });

  it("retries a transient AI failure while attempts remain", async () => {
    const deps = makeDeps();
    deps.ai.interpret.mockRejectedValue(aiDown());
    await expect(
      runJob("task-processing", { id: "t", data: textJob, ...attempt(0) }, deps),
    ).rejects.toThrow();
    expect(deps.actions.save).not.toHaveBeenCalled();
  });

  it("proposes the raw text as a task on the final attempt instead of losing it", async () => {
    const deps = makeDeps();
    deps.ai.interpret.mockRejectedValue(aiDown());
    const result = await runJob("task-processing", { id: "t", data: textJob, ...attempt(2) }, deps);
    expect(result).toMatchObject({ action: "create", usedAi: false });
    expect(deps.actions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({ title: "Buy milk tomorrow", priority: "MEDIUM" }),
      }),
    );
  });

  it("falls back immediately when the AI error is not retryable", async () => {
    const deps = makeDeps();
    deps.ai.interpret.mockRejectedValue(new AppError("AI_BAD_OUTPUT", "garbage"));
    await expect(
      runJob("task-processing", { id: "t", data: textJob, ...attempt(0) }, deps),
    ).resolves.toMatchObject({ usedAi: false });
  });
});

describe("notification processor", () => {
  it("shows the proposal with Confirm / Cancel buttons", async () => {
    const deps = makeDeps();
    deps.actions.get.mockResolvedValue({
      id: "11",
      kind: "create",
      telegramUserId: 777,
      userId: "user_1",
      chatId: 777,
      transcript: null,
      updateId: 11,
      source: "TEXT",
      originalText: "buy milk",
      task: { title: "Buy milk", description: null, priority: "HIGH", dueDate: null },
    });
    await runJob(
      "notifications",
      {
        id: "n",
        data: { kind: "action_proposed", actionId: "11", chatId: 777, statusMessageId: 601 },
        ...attempt(0),
      },
      deps,
    );
    const edit = deps.telegram.editMessageText.mock.calls[0]?.[0];
    expect(edit).toMatchObject({ message_id: 601, parse_mode: "HTML" });
    expect(edit?.text).toContain("Create a new task");
    const buttons: InlineKeyboardButton[] = edit?.reply_markup?.inline_keyboard[0] ?? [];
    expect(buttons.map((b) => b.callback_data)).toEqual(["ac:11:y", "ac:11:n"]);
  });

  it("sends clarifying replies as escaped plain text", async () => {
    const deps = makeDeps();
    await runJob(
      "notifications",
      {
        id: "n",
        data: { kind: "reply", chatId: 777, statusMessageId: 601, text: "Which <task>?" },
        ...attempt(0),
      },
      deps,
    );
    expect(deps.telegram.editMessageText).toHaveBeenCalledWith(
      expect.objectContaining({ message_id: 601, text: "Which &lt;task&gt;?" }),
    );
  });

  it("syncs the card after a change made elsewhere", async () => {
    const deps = makeDeps();
    deps.tasks.getRecord.mockResolvedValue(makeRecord({ status: "COMPLETED" }, 700));
    await runJob(
      "notifications",
      { id: "n", data: { kind: "task_updated", taskId: "task_1" }, ...attempt(0) },
      deps,
    );
    expect(deps.telegram.editMessageText).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: 777,
        message_id: 700,
        text: expect.stringContaining("Status: Completed"),
      }),
    );
  });
});

describe("runJob validation", () => {
  it("rejects malformed payloads without retrying", async () => {
    const run = runJob(
      "transcription",
      { id: "bad", data: { nope: true }, ...attempt(0) },
      makeDeps(),
    );
    await expect(run).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(run).rejects.toThrow("[INVALID_JOB]");
  });
});

describe("handleFinalFailure", () => {
  it("tells the user why the voice message failed", async () => {
    const deps = makeDeps();
    await handleFinalFailure(
      "transcription",
      voiceJob,
      new Error("[EMPTY_TRANSCRIPT] nothing"),
      deps,
    );
    expect(deps.telegram.editMessageText).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: 600,
        text: expect.stringContaining("couldn't hear any speech"),
      }),
    );
  });

  it("never throws, even if Telegram is unreachable", async () => {
    const deps = makeDeps();
    deps.telegram.editMessageText.mockRejectedValue(new Error("down"));
    await expect(
      handleFinalFailure("task-processing", textJob, new Error("x"), deps),
    ).resolves.toBeUndefined();
  });
});
