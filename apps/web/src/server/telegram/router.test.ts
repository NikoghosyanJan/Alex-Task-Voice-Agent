import { describe, expect, it } from "vitest";
import type { TgMessage, TgUpdate } from "@taskbot/shared";
import { classifyUpdate, parseCommand } from "./router";

const from = { id: 777, is_bot: false, first_name: "Zhanna", username: "zhanna" };
const chat = { id: 777, type: "private" as const };

function message(extra: Partial<TgMessage>): TgUpdate {
  return { update_id: 1, message: { message_id: 10, date: 0, chat, from, ...extra } };
}

describe("parseCommand", () => {
  it("recognises commands, including the @botname form", () => {
    expect(parseCommand("/start")).toBe("start");
    expect(parseCommand("/tasks@MyTaskBot")).toBe("tasks");
    expect(parseCommand("/HELP please")).toBe("help");
    expect(parseCommand("/whatever")).toBe("unknown");
    expect(parseCommand("not a command")).toBeNull();
    expect(parseCommand("path/like/text")).toBeNull();
  });
});

describe("classifyUpdate", () => {
  it("routes plain text to task creation", () => {
    expect(classifyUpdate(message({ text: "  Buy milk  " }))).toMatchObject({
      kind: "text",
      text: "Buy milk",
    });
  });

  it("routes commands", () => {
    expect(classifyUpdate(message({ text: "/tasks" }))).toMatchObject({
      kind: "command",
      command: "tasks",
    });
  });

  it("routes voice notes and audio files to transcription", () => {
    const voice = classifyUpdate(
      message({
        voice: {
          file_id: "F",
          file_unique_id: "U",
          duration: 7,
          mime_type: "audio/ogg",
          file_size: 100,
        },
      }),
    );
    expect(voice).toMatchObject({
      kind: "audio",
      media: { kind: "voice", fileId: "F", durationSec: 7 },
    });

    const audio = classifyUpdate(
      message({
        audio: { file_id: "A", file_unique_id: "U", duration: 30, mime_type: "audio/mpeg" },
      }),
    );
    expect(audio).toMatchObject({
      kind: "audio",
      media: { kind: "audio", mimeType: "audio/mpeg" },
    });
  });

  it("parses status buttons and ignores foreign callbacks", () => {
    const callback = { id: "cb", from, data: "st:task123:C" };
    expect(classifyUpdate({ update_id: 2, callback_query: callback })).toMatchObject({
      kind: "status_callback",
      taskId: "task123",
      status: "COMPLETED",
    });
    expect(classifyUpdate({ update_id: 3, callback_query: { ...callback, data: "x" } }).kind).toBe(
      "unknown_callback",
    );
  });

  it("flags unsupported content and ignores bots and empty updates", () => {
    expect(classifyUpdate(message({ photo: [{}] })).kind).toBe("unsupported");
    expect(classifyUpdate(message({ text: "hi", from: { ...from, is_bot: true } })).kind).toBe(
      "ignore",
    );
    expect(classifyUpdate({ update_id: 4 }).kind).toBe("ignore");
  });
});
