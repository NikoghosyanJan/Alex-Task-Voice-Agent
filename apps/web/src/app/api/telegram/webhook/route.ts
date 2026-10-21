import type { NextRequest } from "next/server";
import { errorDetails, getEnv, getRedis, logger, type TgUpdate } from "@taskbot/shared";
import { scheduleDrain } from "@/server/drainTrigger";
import { jsonError, safeEqual } from "@/server/http";
import { createWebhookDeps } from "@/server/telegram/deps";
import { handleUpdate } from "@/server/telegram/handleUpdate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEDUPE_TTL_SEC = 60 * 60;

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!safeEqual(secret, getEnv().TELEGRAM_WEBHOOK_SECRET)) {
    return jsonError(401, "invalid secret token");
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return jsonError(400, "invalid JSON");
  }
  if (typeof update?.update_id !== "number") {
    return jsonError(400, "missing update_id");
  }

  const redis = getRedis();
  const dedupeKey = `tg:update:${update.update_id}`;
  const log = logger.child({ updateId: update.update_id });

  try {
    // Telegram re-delivers an update if we're slow or fail; process each one once.
    const isNew = (await redis.set(dedupeKey, "1", "EX", DEDUPE_TTL_SEC, "NX")) === "OK";
    if (!isNew) {
      log.info("duplicate update ignored");
      return Response.json({ ok: true, duplicate: true });
    }

    const startedAt = Date.now();
    const result = await handleUpdate(update, createWebhookDeps());
    log.info({ ...result, ms: Date.now() - startedAt }, "update handled");

    if (result.enqueued) scheduleDrain(`telegram:${result.action}`);
    return Response.json({ ok: true });
  } catch (err) {
    log.error({ err: errorDetails(err) }, "failed to handle update");
    // Let Telegram retry this update.
    await redis.del(dedupeKey).catch(() => undefined);
    return jsonError(500, "internal error");
  }
}
