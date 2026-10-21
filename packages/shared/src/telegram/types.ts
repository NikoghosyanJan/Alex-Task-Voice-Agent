/** Subset of the Telegram Bot API types used by this app. */

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

export interface TgVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TgAudio extends TgVoice {
  title?: string;
  file_name?: string;
}

export interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
  voice?: TgVoice;
  audio?: TgAudio;
  video_note?: unknown;
  photo?: unknown[];
  document?: unknown;
  sticker?: unknown;
  reply_to_message?: TgMessage;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface TgFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface SendMessageParams {
  chat_id: number;
  text: string;
  parse_mode?: "HTML" | "MarkdownV2";
  reply_markup?: InlineKeyboardMarkup;
  reply_parameters?: { message_id: number; allow_sending_without_reply?: boolean };
  link_preview_options?: { is_disabled: boolean };
}

export interface EditMessageTextParams {
  chat_id: number;
  message_id: number;
  text: string;
  parse_mode?: "HTML" | "MarkdownV2";
  reply_markup?: InlineKeyboardMarkup;
  link_preview_options?: { is_disabled: boolean };
}

export interface EditMessageReplyMarkupParams {
  chat_id: number;
  message_id: number;
  reply_markup?: InlineKeyboardMarkup;
}

export interface BotCommand {
  command: string;
  description: string;
}
