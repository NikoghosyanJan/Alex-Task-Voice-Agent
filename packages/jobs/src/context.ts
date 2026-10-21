import type { Logger, QueueNameValue } from "@taskbot/shared";

export interface JobContext {
  jobId: string;
  queue: QueueNameValue;
  /** Failed attempts before this one. */
  attemptsMade: number;
  maxAttempts: number;
  isFinalAttempt: boolean;
  log: Logger;
}
