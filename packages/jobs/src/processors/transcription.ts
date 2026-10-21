import {
  AppError,
  audioFileNameFor,
  errorDetails,
  QueueName,
  type TranscriptionJob,
} from "@taskbot/shared";
import type { JobContext } from "../context";
import type { JobDeps } from "../deps";
import { messages, showStatus } from "../telegram/messages";

export const MAX_VOICE_SECONDS = 5 * 60;
/** Bot API getFile limit. */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export async function processTranscription(
  data: TranscriptionJob,
  ctx: JobContext,
  deps: JobDeps,
): Promise<{ transcriptChars: number }> {
  if (data.durationSec > MAX_VOICE_SECONDS) {
    throw new AppError(
      "VOICE_TOO_LONG",
      `duration ${data.durationSec}s exceeds ${MAX_VOICE_SECONDS}s`,
    );
  }

  const file = await deps.telegram.getFile(data.fileId);
  if (!file.file_path || (file.file_size ?? 0) > MAX_AUDIO_BYTES) {
    throw new AppError("FILE_TOO_LARGE", `file_size=${file.file_size ?? "unknown"}`);
  }

  const audio = await deps.telegram.downloadFile(file.file_path);
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    throw new AppError("FILE_TOO_LARGE", `downloaded ${audio.byteLength} bytes`);
  }

  const startedAt = Date.now();
  const transcript = await deps.ai.transcribe(
    audio,
    audioFileNameFor(file.file_path, data.mimeType),
  );
  ctx.log.info(
    { ms: Date.now() - startedAt, chars: transcript.length, bytes: audio.byteLength },
    "voice transcribed",
  );

  if (!transcript) {
    throw new AppError("EMPTY_TRANSCRIPT", "transcription returned no text");
  }

  // Progress feedback is best effort: failing here must not trigger a (paid) re-transcription.
  let statusMessageId = data.statusMessageId;
  try {
    statusMessageId = await showStatus(
      deps.telegram,
      data.chatId,
      data.statusMessageId,
      messages.transcribed(transcript),
    );
  } catch (err) {
    ctx.log.warn({ err: errorDetails(err) }, "could not update status message");
  }

  await deps.enqueue(
    QueueName.TaskProcessing,
    {
      updateId: data.updateId,
      chatId: data.chatId,
      userId: data.userId,
      statusMessageId,
      source: "VOICE",
      text: transcript,
      transcript,
    },
    { jobId: `task-${data.updateId}` },
  );

  return { transcriptChars: transcript.length };
}
