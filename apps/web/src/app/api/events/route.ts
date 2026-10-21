import type { NextRequest } from "next/server";
import { createRedisConnection, errorDetails, logger, TASK_EVENTS_CHANNEL } from "@taskbot/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HEARTBEAT_MS = 15_000;
/** Close before the platform's maxDuration so the browser reconnects cleanly instead of erroring. */
const STREAM_LIFETIME_MS = 280_000;
const CLIENT_RETRY_MS = 3_000;

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  const subscriber = createRedisConnection({ connectionName: "taskbot:sse" });
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  let closeStream: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closeStream();
        }
      };

      closeStream = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        subscriber.quit().catch(() => subscriber.disconnect());
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };

      request.signal.addEventListener("abort", closeStream);

      subscriber.on("message", (_channel, payload) => {
        send(`event: task\ndata: ${payload}\n\n`);
      });

      try {
        await subscriber.subscribe(TASK_EVENTS_CHANNEL);
      } catch (err) {
        logger.error({ err: errorDetails(err) }, "SSE subscribe failed");
        send(`retry: ${CLIENT_RETRY_MS}\nevent: error\ndata: {"message":"subscribe failed"}\n\n`);
        closeStream();
        return;
      }

      send(`retry: ${CLIENT_RETRY_MS}\nevent: ready\ndata: {}\n\n`);
      heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);
      lifetime = setTimeout(closeStream, STREAM_LIFETIME_MS);
    },
    cancel() {
      closeStream();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
