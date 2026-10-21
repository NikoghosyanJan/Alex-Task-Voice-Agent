import { UnrecoverableError } from "bullmq";
import { describe, expect, it } from "vitest";
import { AppError } from "@taskbot/shared";
import { handleFinalFailure } from "../failure";
import { makeDeps, makeRecord } from "../testUtils";
import { runJob } from "./index";

const voiceJob = {
  updateId: 10,
  chatId: 777,
  userId: "user_1",
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
  it("stores the AI-structured task and queues the Telegram card", async () => {
    const deps = makeDeps();
    deps.tasks.createFromTelegram.mockResolvedValue({
      record: makeRecord({ id: "task_9" }),
      created: true,
    });
    const result = await runJob(
      "task-processing",
      { id: "task-11", data: textJob, ...attempt(0) },
      deps,
    );

    expect(result).toEqual({ taskId: "task_9", created: true, structured: true });
    expect(deps.tasks.createFromTelegram).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Buy milk",
        priority: "HIGH",
        updateId: 11,
        originalText: "Buy milk tomorrow",
      }),
    );
    expect(deps.enqueue).toHaveBeenCalledWith(
      "notifications",
      { kind: "task_created", taskId: "task_9", chatId: 777, statusMessageId: 601 },
      { jobId: "notify-created-task_9" },
    );
  });

  it("retries a transient AI failure while attempts remain", async () => {
    const deps = makeDeps();
    deps.ai.structure.mockRejectedValue(aiDown());
    await expect(
      runJob("task-processing", { id: "t", data: textJob, ...attempt(0) }, deps),
    ).rejects.toThrow();
    expect(deps.tasks.createFromTelegram).not.toHaveBeenCalled();
  });

  it("falls back to the raw text on the final attempt instead of losing the task", async () => {
    const deps = makeDeps();
    deps.ai.structure.mockRejectedValue(aiDown());
    const result = await runJob("task-processing", { id: "t", data: textJob, ...attempt(2) }, deps);
    expect(result).toMatchObject({ structured: false });
    expect(deps.tasks.createFromTelegram).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Buy milk tomorrow", priority: "MEDIUM" }),
    );
  });

  it("falls back immediately when the AI error is not retryable", async () => {
    const deps = makeDeps();
    deps.ai.structure.mockRejectedValue(new AppError("AI_BAD_OUTPUT", "garbage"));
    await expect(
      runJob("task-processing", { id: "t", data: textJob, ...attempt(0) }, deps),
    ).resolves.toMatchObject({
      structured: false,
    });
  });
});

describe("notification processor", () => {
  it("turns the status message into the task card and remembers its id", async () => {
    const deps = makeDeps();
    await runJob(
      "notifications",
      {
        id: "n",
        data: { kind: "task_created", taskId: "task_1", chatId: 777, statusMessageId: 601 },
        ...attempt(0),
      },
      deps,
    );
    const edit = deps.telegram.editMessageText.mock.calls[0]?.[0];
    expect(edit).toMatchObject({ message_id: 601, parse_mode: "HTML" });
    expect(edit?.text).toContain("Task created");
    expect(edit?.reply_markup?.inline_keyboard[0]).toHaveLength(2);
    expect(deps.tasks.setCardMessageId).toHaveBeenCalledWith("task_1", 601);
  });

  it("syncs the card after a dashboard status change", async () => {
    const deps = makeDeps();
    deps.tasks.getRecord.mockResolvedValue(makeRecord({ status: "COMPLETED" }, 700));
    await runJob(
      "notifications",
      { id: "n", data: { kind: "task_status_changed", taskId: "task_1" }, ...attempt(0) },
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
