import { getEnv, requireEnv } from "../env";
import type {
  BotCommand,
  EditMessageReplyMarkupParams,
  EditMessageTextParams,
  InlineKeyboardMarkup,
  SendMessageParams,
  TgFile,
  TgMessage,
} from "./types";

const DEFAULT_API_BASE = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 10_000;
/** Telegram's own retry_after hints up to this size are honored inline instead of failing the job. */
const MAX_INLINE_RETRY_AFTER_SEC = 3;

export class TelegramApiError extends Error {
  readonly method: string;
  readonly status: number;
  readonly description: string;
  readonly retryAfterSec?: number;

  constructor(method: string, status: number, description: string, retryAfterSec?: number) {
    super(`Telegram ${method} failed (${status}): ${description}`);
    this.name = "TelegramApiError";
    this.method = method;
    this.status = status;
    this.description = description;
    this.retryAfterSec = retryAfterSec;
  }

  /** 0 = network error / timeout. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

export class TelegramClient {
  private readonly token: string;
  private readonly apiBase: string;

  constructor(token: string, apiBase: string = DEFAULT_API_BASE) {
    this.token = token;
    this.apiBase = apiBase.replace(/\/+$/, "");
  }

  async call<T>(
    method: string,
    params: object = {},
    { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${this.apiBase}/bot${this.token}/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new TelegramApiError(method, 0, err instanceof Error ? err.message : String(err));
      }

      const body = (await response.json().catch(() => null)) as TelegramResponse<T> | null;
      if (body?.ok) return body.result as T;

      const status = body?.error_code ?? response.status;
      const retryAfter = body?.parameters?.retry_after;
      if (
        status === 429 &&
        attempt === 0 &&
        retryAfter &&
        retryAfter <= MAX_INLINE_RETRY_AFTER_SEC
      ) {
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1_000));
        continue;
      }
      throw new TelegramApiError(
        method,
        status,
        body?.description ?? response.statusText,
        retryAfter,
      );
    }
  }

  sendMessage(params: SendMessageParams): Promise<TgMessage> {
    return this.call<TgMessage>("sendMessage", {
      link_preview_options: { is_disabled: true },
      ...params,
    });
  }

  /** Returns null when the text and markup are unchanged (Telegram reports that as an error). */
  async editMessageText(params: EditMessageTextParams): Promise<TgMessage | null> {
    try {
      const result = await this.call<TgMessage | true>("editMessageText", {
        link_preview_options: { is_disabled: true },
        ...params,
      });
      return result === true ? null : result;
    } catch (err) {
      if (err instanceof TelegramApiError && err.description.includes("message is not modified")) {
        return null;
      }
      throw err;
    }
  }

  /** Omitting reply_markup removes the inline keyboard. */
  async editMessageReplyMarkup(params: EditMessageReplyMarkupParams): Promise<void> {
    try {
      await this.call<TgMessage | true>("editMessageReplyMarkup", params);
    } catch (err) {
      if (err instanceof TelegramApiError && err.description.includes("message is not modified")) {
        return;
      }
      throw err;
    }
  }

  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<true> {
    return this.call<true>("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
  }

  getFile(fileId: string): Promise<TgFile> {
    return this.call<TgFile>("getFile", { file_id: fileId });
  }

  async downloadFile(
    filePath: string,
    { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
  ): Promise<Buffer> {
    let response: Response;
    try {
      response = await fetch(`${this.apiBase}/file/bot${this.token}/${filePath}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new TelegramApiError(
        "downloadFile",
        0,
        err instanceof Error ? err.message : String(err),
      );
    }
    if (!response.ok) {
      throw new TelegramApiError("downloadFile", response.status, response.statusText);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  setWebhook(params: {
    url: string;
    secret_token: string;
    allowed_updates: string[];
    drop_pending_updates?: boolean;
    max_connections?: number;
  }): Promise<true> {
    return this.call<true>("setWebhook", params);
  }

  deleteWebhook(dropPendingUpdates = false): Promise<true> {
    return this.call<true>("deleteWebhook", { drop_pending_updates: dropPendingUpdates });
  }

  getWebhookInfo(): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>("getWebhookInfo");
  }

  setMyCommands(commands: BotCommand[]): Promise<true> {
    return this.call<true>("setMyCommands", { commands });
  }

  getMe(): Promise<{ id: number; username: string; first_name: string }> {
    return this.call("getMe");
  }
}

export type { InlineKeyboardMarkup };

const globalForTelegram = globalThis as unknown as { __taskbotTelegram?: TelegramClient };

export function getTelegram(): TelegramClient {
  globalForTelegram.__taskbotTelegram ??= new TelegramClient(
    requireEnv("TELEGRAM_BOT_TOKEN"),
    getEnv().TELEGRAM_API_BASE,
  );
  return globalForTelegram.__taskbotTelegram;
}
