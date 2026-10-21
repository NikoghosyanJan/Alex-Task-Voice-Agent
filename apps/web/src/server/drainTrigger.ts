import { after } from "next/server";
import { errorDetails, getAppUrl, getEnv, logger } from "@taskbot/shared";

export const WORKER_SECRET_HEADER = "x-worker-secret";

/**
 * In serverless mode there is no always-on worker, so whoever enqueues a job pokes the
 * drain endpoint after the response is sent. The drain runs as its own invocation, which
 * keeps this request (e.g. the Telegram webhook) fast. No-op in standalone mode.
 */
export function scheduleDrain(reason: string): void {
  const env = getEnv();
  if (env.WORKER_MODE !== "serverless") return;
  if (!env.WORKER_SECRET) {
    logger.error("WORKER_MODE=serverless but WORKER_SECRET is not set; jobs will not be processed");
    return;
  }

  const secret = env.WORKER_SECRET;
  after(async () => {
    try {
      const response = await fetch(`${getAppUrl()}/api/worker/drain`, {
        method: "POST",
        headers: { [WORKER_SECRET_HEADER]: secret },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        logger.warn({ reason, status: response.status }, "drain trigger rejected");
      }
    } catch (err) {
      logger.warn({ reason, err: errorDetails(err) }, "drain trigger failed");
    }
  });
}
