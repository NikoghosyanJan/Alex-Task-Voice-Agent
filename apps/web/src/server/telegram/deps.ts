import {
  getTaskRecord,
  listRecentTasksForTelegramUser,
  updateTaskStatus,
  upsertTelegramUser,
} from "@taskbot/jobs";
import { enqueue, getAppUrl, getTelegram, getTimeZone, logger } from "@taskbot/shared";
import type { WebhookDeps } from "./handleUpdate";

export function createWebhookDeps(): WebhookDeps {
  return {
    telegram: getTelegram(),
    users: { upsert: upsertTelegramUser },
    tasks: {
      getRecord: getTaskRecord,
      updateStatus: updateTaskStatus,
      recentForUser: listRecentTasksForTelegramUser,
    },
    enqueue,
    appUrl: getAppUrl(),
    timeZone: getTimeZone(),
    log: logger.child({ component: "webhook" }),
  };
}
