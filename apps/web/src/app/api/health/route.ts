import { getPrisma } from "@taskbot/db";
import { ALL_QUEUES, errorDetails, getEnv, getQueue, getRedis } from "@taskbot/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function check<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: String(errorDetails(err).message) };
  }
}

export async function GET() {
  const [database, redis, queues] = await Promise.all([
    check(async () => {
      await getPrisma().$queryRaw`SELECT 1`;
      return "up";
    }),
    check(async () => getRedis().ping()),
    check(async () =>
      Object.fromEntries(
        await Promise.all(
          ALL_QUEUES.map(async (name) => [
            name,
            await getQueue(name).getJobCounts("waiting", "active", "delayed", "failed"),
          ]),
        ),
      ),
    ),
  ]);

  const ok = database.ok && redis.ok;
  return Response.json(
    { ok, workerMode: getEnv().WORKER_MODE, database, redis, queues },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
