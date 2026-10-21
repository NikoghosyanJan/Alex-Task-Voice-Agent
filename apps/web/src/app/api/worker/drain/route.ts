import { after, type NextRequest } from "next/server";
import { runServerlessDrain } from "@taskbot/jobs";
import { errorDetails, getEnv, logger } from "@taskbot/shared";
import { WORKER_SECRET_HEADER } from "@/server/drainTrigger";
import { jsonError, safeEqual } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function startDrain(trigger: string): Response {
  // Respond right away so the caller isn't kept waiting; the drain continues in after().
  after(async () => {
    try {
      const result = await runServerlessDrain({ budgetMs: 60_000 });
      logger.info({ trigger, ...result }, "drain finished");
    } catch (err) {
      logger.error({ trigger, err: errorDetails(err) }, "drain crashed");
    }
  });
  return Response.json({ accepted: true }, { status: 202 });
}

export async function POST(request: NextRequest) {
  if (!safeEqual(request.headers.get(WORKER_SECRET_HEADER), getEnv().WORKER_SECRET)) {
    return jsonError(401, "unauthorized");
  }
  return startDrain("enqueue");
}

/** Vercel Cron safety net (sends `Authorization: Bearer $CRON_SECRET`). */
export async function GET(request: NextRequest) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!safeEqual(bearer, getEnv().CRON_SECRET)) {
    return jsonError(401, "unauthorized");
  }
  return startDrain("cron");
}
