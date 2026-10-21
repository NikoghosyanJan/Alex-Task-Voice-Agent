import { errorDetails, logger } from "./logger";
import { getRedis } from "./redis";
import type { TaskEvent } from "./types";

export const TASK_EVENTS_CHANNEL = "tasks:events";

/** Best effort: a missed live update is recovered by the dashboard's resync on reconnect. */
export async function publishTaskEvent(event: TaskEvent): Promise<void> {
  try {
    await getRedis().publish(TASK_EVENTS_CHANNEL, JSON.stringify(event));
  } catch (err) {
    logger.warn({ err: errorDetails(err), type: event.type }, "failed to publish task event");
  }
}
