import { describe, expect, it, vi } from "vitest";
import { formatTaskNumber, TelegramApiError, type TaskDTO } from "@taskbot/shared";
import type { PendingAction } from "../actions/pendingActions";
import {
  actionCallbackData,
  escapeHtml,
  formatProposal,
  formatTaskCard,
  parseActionCallback,
  parseStatusCallback,
  proposalKeyboard,
  showStatus,
  statusCallbackData,
  taskKeyboard,
} from "./messages";

const task: TaskDTO = {
  id: "cmabc123",
  number: 7,
  title: "Fix <script> & stuff",
  description: null,
  status: "PENDING",
  priority: "HIGH",
  dueDate: "2026-10-22T05:00:00.000Z",
  source: "VOICE",
  originalText: "fix it",
  transcript: "fix the script and stuff",
  createdAt: "2026-10-21T05:00:00.000Z",
  updatedAt: "2026-10-21T05:00:00.000Z",
  author: { username: "zhanna", firstName: "Zhanna" },
};

describe("status callbacks", () => {
  it("round-trips task id and status within Telegram's 64 byte limit", () => {
    const data = statusCallbackData("c".repeat(25), "IN_PROGRESS");
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(parseStatusCallback(data)).toEqual({ taskId: "c".repeat(25), status: "IN_PROGRESS" });
  });

  it("rejects foreign callback data", () => {
    expect(parseStatusCallback("st:abc:X")).toBeNull();
    expect(parseStatusCallback("other")).toBeNull();
    expect(parseStatusCallback(undefined)).toBeNull();
  });
});

describe("formatting", () => {
  it("pads task numbers to at least two digits", () => {
    expect(formatTaskNumber(1)).toBe("#01");
    expect(formatTaskNumber(99)).toBe("#99");
    expect(formatTaskNumber(100)).toBe("#100");
  });

  it("escapes HTML in user content", () => {
    expect(escapeHtml("a <b> & c")).toBe("a &lt;b&gt; &amp; c");
    const card = formatTaskCard(task, { header: "Task created", timeZone: "Asia/Yerevan" });
    expect(card).toContain("#07 · Fix &lt;script&gt; &amp; stuff");
    expect(card).toContain("Due: Thu 22 Oct, 09:00");
    expect(card).toContain("Heard:");
  });

  it("offers the other statuses and a dashboard link only for https URLs", () => {
    const local = taskKeyboard(task, "http://localhost:3000");
    expect(local.inline_keyboard).toHaveLength(1);
    expect(local.inline_keyboard[0]?.map((b) => b.text)).toEqual(["Start", "Done"]);
    expect(taskKeyboard(task, "https://taskbot.vercel.app").inline_keyboard[1]?.[0]?.url).toBe(
      "https://taskbot.vercel.app",
    );
  });
});

describe("proposals", () => {
  it("round-trips Confirm / Cancel callback data", () => {
    expect(parseActionCallback(actionCallbackData("123456789", true))).toEqual({
      actionId: "123456789",
      confirmed: true,
    });
    expect(parseActionCallback("ac:1:n")).toEqual({ actionId: "1", confirmed: false });
    expect(parseActionCallback("ac:1:x")).toBeNull();
    expect(proposalKeyboard("9").inline_keyboard[0]?.map((b) => b.text)).toEqual([
      "Confirm",
      "Cancel",
    ]);
  });

  it("describes each planned change as old -> new", () => {
    const action: PendingAction = {
      id: "1",
      kind: "update",
      telegramUserId: 777,
      userId: "user_1",
      chatId: 777,
      transcript: "put the script task in progress",
      taskId: task.id,
      before: { ...task, number: 7 },
      changes: {
        status: "IN_PROGRESS",
        priority: "LOW",
        title: "Fix the build",
        dueDate: null,
        description: "Check CI first",
      },
    };
    const text = formatProposal(action, { header: "Confirm?", timeZone: "Asia/Yerevan" });
    expect(text).toContain("Update task <b>#07 · Fix &lt;script&gt; &amp; stuff</b>");
    expect(text).toContain("• Status: Pending → In Progress");
    expect(text).toContain("• Priority: High → Low");
    expect(text).toContain('• Title: "Fix &lt;script&gt; &amp; stuff" → "Fix the build"');
    expect(text).toContain('• Description: "Check CI first"');
    expect(text).toContain("• Due: Thu 22 Oct, 09:00 → none");
    expect(text).toContain('Heard: "put the script task in progress"');
  });

  it("names the task to delete", () => {
    const action: PendingAction = {
      id: "3",
      kind: "delete",
      telegramUserId: 777,
      userId: "user_1",
      chatId: 777,
      transcript: null,
      taskId: task.id,
      before: { ...task, number: 3, title: "Buy something" },
    };
    const text = formatProposal(action, { header: "Confirm?", timeZone: "Asia/Yerevan" });
    expect(text).toContain("I'm planning to delete this task:\n<b>#03 · Buy something</b>");
    expect(text).toContain("Due: Thu 22 Oct, 09:00");
    expect(text).toContain("This can't be undone.");
  });

  it("lists the fields of a task to create", () => {
    const action: PendingAction = {
      id: "2",
      kind: "create",
      telegramUserId: 777,
      userId: "user_1",
      chatId: 777,
      transcript: null,
      updateId: 2,
      source: "TEXT",
      originalText: "buy milk",
      task: { title: "Buy milk", description: null, priority: "HIGH", dueDate: null },
    };
    const text = formatProposal(action, { header: "Confirm?", timeZone: "UTC" });
    expect(text).toContain("Create a new task:\n<b>Buy milk</b>");
    expect(text).toContain("Priority: High");
    expect(text).not.toContain("Due:");
  });
});

describe("showStatus", () => {
  it("edits the status message in place", async () => {
    const telegram = { editMessageText: vi.fn().mockResolvedValue(null), sendMessage: vi.fn() };
    await expect(showStatus(telegram, 1, 42, "hi")).resolves.toBe(42);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("sends a new message when the original can't be edited", async () => {
    const telegram = {
      editMessageText: vi
        .fn()
        .mockRejectedValue(
          new TelegramApiError("editMessageText", 400, "message to edit not found"),
        ),
      sendMessage: vi.fn().mockResolvedValue({ message_id: 99 }),
    };
    await expect(showStatus(telegram, 1, 42, "hi")).resolves.toBe(99);
  });

  it("propagates transient errors so the job can retry", async () => {
    const telegram = {
      editMessageText: vi
        .fn()
        .mockRejectedValue(new TelegramApiError("editMessageText", 502, "bad gateway")),
      sendMessage: vi.fn(),
    };
    await expect(showStatus(telegram, 1, 42, "hi")).rejects.toThrow("bad gateway");
  });
});
