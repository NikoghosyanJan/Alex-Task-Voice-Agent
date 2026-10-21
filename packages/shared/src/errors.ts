import { APIConnectionError, APIError } from "openai";
import { TelegramApiError } from "./telegram/client";

export type ErrorCode =
  | "VOICE_TOO_LONG"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_MEDIA"
  | "EMPTY_TRANSCRIPT"
  | "AI_QUOTA"
  | "AI_AUTH"
  | "AI_BAD_REQUEST"
  | "AI_BAD_OUTPUT"
  | "AI_RATE_LIMITED"
  | "AI_UNAVAILABLE"
  | "TELEGRAM_ERROR"
  | "INVALID_JOB"
  | "UNKNOWN";

export const USER_MESSAGES: Record<ErrorCode, string> = {
  VOICE_TOO_LONG: "The voice message is too long.",
  FILE_TOO_LARGE: "The file is too large to process.",
  UNSUPPORTED_MEDIA: "This audio format isn't supported.",
  EMPTY_TRANSCRIPT: "I couldn't hear any speech in that message.",
  AI_QUOTA: "The AI service quota is exhausted.",
  AI_AUTH: "The AI service is misconfigured.",
  AI_BAD_REQUEST: "The AI service rejected the audio.",
  AI_BAD_OUTPUT: "The AI service returned an unexpected response.",
  AI_RATE_LIMITED: "The AI service is busy right now.",
  AI_UNAVAILABLE: "The AI service is temporarily unavailable.",
  TELEGRAM_ERROR: "Telegram didn't respond in time.",
  INVALID_JOB: "Something went wrong with this request.",
  UNKNOWN: "Something unexpected went wrong.",
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    { retryable = false, cause }: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause });
    this.name = "AppError";
    this.code = code;
    this.retryable = retryable;
  }

  get userMessage(): string {
    return USER_MESSAGES[this.code];
  }
}

/** Normalizes any thrown value into an AppError with a code and a retry decision. */
export function classifyError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof TelegramApiError) {
    return new AppError("TELEGRAM_ERROR", err.message, { retryable: err.retryable, cause: err });
  }

  if (err instanceof APIConnectionError) {
    return new AppError("AI_UNAVAILABLE", err.message, { retryable: true, cause: err });
  }

  if (err instanceof APIError) {
    const status = err.status ?? 0;
    if (status === 429) {
      const quota = err.code === "insufficient_quota";
      return new AppError(quota ? "AI_QUOTA" : "AI_RATE_LIMITED", err.message, {
        retryable: !quota,
        cause: err,
      });
    }
    if (status === 401 || status === 403) {
      return new AppError("AI_AUTH", err.message, { cause: err });
    }
    if (status >= 400 && status < 500) {
      return new AppError("AI_BAD_REQUEST", err.message, { cause: err });
    }
    return new AppError("AI_UNAVAILABLE", err.message, { retryable: true, cause: err });
  }

  const message = err instanceof Error ? err.message : String(err);
  return new AppError("UNKNOWN", message, { retryable: true, cause: err });
}

const CODE_PREFIX = /^\[([A-Z_]+)\]\s/;

/** Error messages stored on BullMQ jobs carry the code, e.g. "[EMPTY_TRANSCRIPT] ...". */
export function formatJobErrorMessage(error: AppError): string {
  return `[${error.code}] ${error.message}`;
}

export function codeFromJobError(err: unknown): ErrorCode {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const match = CODE_PREFIX.exec(message);
  if (match && match[1] && match[1] in USER_MESSAGES) return match[1] as ErrorCode;
  return "UNKNOWN";
}
