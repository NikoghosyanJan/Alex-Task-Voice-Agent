import { toFile } from "openai";
import { getOpenAI, getTranscribeModel } from "./openai";

export interface TranscribeOptions {
  filename: string;
  mimeType: string;
}

export async function transcribeAudio(audio: Buffer, options: TranscribeOptions): Promise<string> {
  const file = await toFile(audio, options.filename, { type: options.mimeType });
  const result = await getOpenAI().audio.transcriptions.create({
    file,
    model: getTranscribeModel(),
    response_format: "json",
  });
  return result.text.trim();
}

/** Telegram voice notes are OGG/Opus with an `.oga` path; OpenAI accepts them as `.ogg`. */
export function audioFileNameFor(
  filePath: string,
  mimeType?: string,
): { filename: string; mimeType: string } {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "oga" || ext === "ogg" || ext === "opus" || !ext) {
    return { filename: "voice.ogg", mimeType: "audio/ogg" };
  }
  return { filename: `audio.${ext}`, mimeType: mimeType ?? `audio/${ext}` };
}
