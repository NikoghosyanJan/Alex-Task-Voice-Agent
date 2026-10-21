import OpenAI from "openai";
import { getEnv, requireEnv } from "../env";

const globalForOpenAI = globalThis as unknown as { __taskbotOpenAI?: OpenAI };

export function getOpenAI(): OpenAI {
  globalForOpenAI.__taskbotOpenAI ??= new OpenAI({
    apiKey: requireEnv("OPENAI_API_KEY"),
    // Job-level retries (BullMQ) handle longer outages; keep SDK retries short for fast feedback.
    maxRetries: 1,
    timeout: 45_000,
  });
  return globalForOpenAI.__taskbotOpenAI;
}

export function getTranscribeModel(): string {
  return getEnv().OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe";
}

export function getTaskModel(): string {
  return getEnv().OPENAI_TASK_MODEL ?? "gpt-4o-mini";
}
