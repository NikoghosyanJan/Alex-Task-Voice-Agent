import { APIConnectionError, APIError } from "openai";
import { describe, expect, it } from "vitest";
import { AppError, classifyError, codeFromJobError, formatJobErrorMessage } from "./errors";
import { TelegramApiError } from "./telegram/client";

function openAiError(status: number, code?: string) {
  return APIError.generate(status, { error: { message: "boom", code } }, "boom", new Headers());
}

describe("classifyError", () => {
  it("retries transient OpenAI failures", () => {
    expect(classifyError(openAiError(500))).toMatchObject({
      code: "AI_UNAVAILABLE",
      retryable: true,
    });
    expect(classifyError(openAiError(429))).toMatchObject({
      code: "AI_RATE_LIMITED",
      retryable: true,
    });
    expect(classifyError(new APIConnectionError({ message: "socket hang up" }))).toMatchObject({
      code: "AI_UNAVAILABLE",
      retryable: true,
    });
  });

  it("does not retry quota, auth or bad requests", () => {
    expect(classifyError(openAiError(429, "insufficient_quota"))).toMatchObject({
      code: "AI_QUOTA",
      retryable: false,
    });
    expect(classifyError(openAiError(401))).toMatchObject({ code: "AI_AUTH", retryable: false });
    expect(classifyError(openAiError(400))).toMatchObject({
      code: "AI_BAD_REQUEST",
      retryable: false,
    });
  });

  it("follows Telegram status codes", () => {
    expect(classifyError(new TelegramApiError("getFile", 0, "timeout")).retryable).toBe(true);
    expect(classifyError(new TelegramApiError("getFile", 502, "bad gateway")).retryable).toBe(true);
    expect(classifyError(new TelegramApiError("getFile", 400, "file is too big")).retryable).toBe(
      false,
    );
  });

  it("passes AppErrors through and treats unknown errors as retryable", () => {
    const appError = new AppError("EMPTY_TRANSCRIPT", "nothing");
    expect(classifyError(appError)).toBe(appError);
    expect(classifyError(new Error("???"))).toMatchObject({ code: "UNKNOWN", retryable: true });
  });
});

describe("job error codes", () => {
  it("round-trips the code through the job error message", () => {
    const message = formatJobErrorMessage(new AppError("VOICE_TOO_LONG", "900s"));
    expect(message).toBe("[VOICE_TOO_LONG] 900s");
    expect(codeFromJobError(new Error(message))).toBe("VOICE_TOO_LONG");
    expect(codeFromJobError(new Error("plain"))).toBe("UNKNOWN");
    expect(codeFromJobError(new Error("[NOT_A_CODE] x"))).toBe("UNKNOWN");
  });
});
