import type { NextRequest } from "next/server";
import { z } from "zod";
import { getTaskRecord, updateTaskStatus } from "@taskbot/jobs";
import { enqueue, errorDetails, logger, QueueName, TASK_STATUSES } from "@taskbot/shared";
import { scheduleDrain } from "@/server/drainTrigger";
import { jsonError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({ status: z.enum(TASK_STATUSES) });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return jsonError(400, "invalid body", body.error.issues);
  }

  try {
    const current = await getTaskRecord(id);
    if (!current) return jsonError(404, "task not found");
    if (current.task.status === body.data.status) return Response.json({ task: current.task });

    const updated = await updateTaskStatus(id, body.data.status);
    if (!updated) return jsonError(404, "task not found");

    if (updated.cardMessageId) {
      // Keeping the Telegram card in sync is async and must not fail the request.
      try {
        await enqueue(QueueName.Notifications, { kind: "task_status_changed", taskId: id });
        scheduleDrain("dashboard:status");
      } catch (err) {
        logger.warn({ taskId: id, err: errorDetails(err) }, "could not enqueue card sync");
      }
    }

    return Response.json({ task: updated.task });
  } catch (err) {
    logger.error({ taskId: id, err: errorDetails(err) }, "failed to update task");
    return jsonError(500, "failed to update task");
  }
}
