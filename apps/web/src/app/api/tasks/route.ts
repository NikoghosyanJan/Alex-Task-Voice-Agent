import { listTasks } from "@taskbot/jobs";
import { errorDetails, logger } from "@taskbot/shared";
import { jsonError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tasks = await listTasks();
    return Response.json({ tasks }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    logger.error({ err: errorDetails(err) }, "failed to list tasks");
    return jsonError(500, "failed to load tasks");
  }
}
