import { describe, expect, it, vi } from "vitest";
import { TelegramApiError, type TaskDTO } from "@taskbot/shared";
import {
  escapeHtml,
  formatTaskCard,
  parseStatusCallback,
  showStatus,
  statusCallbackData,
  taskKeyboard,
} from "./messages";

const task: TaskDTO = {
  id: "cmabc123",
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
  it("escapes HTML in user content", () => {
    expect(escapeHtml("a <b> & c")).toBe("a &lt;b&gt; &amp; c");
    const card = formatTaskCard(task, { header: "Task created", timeZone: "Asia/Yerevan" });
    expect(card).toContain("Fix &lt;script&gt; &amp; stuff");
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
