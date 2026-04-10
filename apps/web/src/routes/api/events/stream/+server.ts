import type { RequestHandler } from "./$types";
import { getActorContext, hasActorUsername } from "$lib/server/auth";
import { createSubscriber } from "@nojv/redis";
import { userChannel } from "@nojv/core";
import { createLogger } from "$lib/server/logger";
import { z } from "zod";

const logger = createLogger("sse-stream");

const sseEnvSchema = z.object({
  REDIS_URL: z.url()
});

const MAX_DURATION_MS = 600_000; // 10 min
const KEEPALIVE_MS = 30_000;
const MAX_SSE_PER_USER = 5;

const sseConnectionCounts = new Map<string, number>();

function acquireSseSlot(userId: string): boolean {
  const current = sseConnectionCounts.get(userId) ?? 0;
  if (current >= MAX_SSE_PER_USER) return false;
  sseConnectionCounts.set(userId, current + 1);
  return true;
}

function releaseSseSlot(userId: string): void {
  const current = sseConnectionCounts.get(userId) ?? 0;
  if (current <= 1) {
    sseConnectionCounts.delete(userId);
  } else {
    sseConnectionCounts.set(userId, current - 1);
  }
}

export const GET: RequestHandler = (event) => {
  const actor = getActorContext(event);
  if (!actor || !hasActorUsername(actor)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const envResult = sseEnvSchema.safeParse(process.env);
  if (!envResult.success) {
    return new Response("SSE not configured", { status: 503 });
  }

  const userId = actor.userId;
  const redisUrl = envResult.data.REDIS_URL;

  if (!acquireSseSlot(userId)) {
    return new Response("Too many concurrent connections", { status: 429 });
  }

  let released = false;
  function releaseOnce() {
    if (!released) {
      released = true;
      releaseSseSlot(userId);
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const subscriber = createSubscriber(redisUrl);
      const channels = [userChannel(userId)];

      function send(data: string) {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Controller may already be closed
        }
      }

      subscriber.subscribe(...channels).catch((err: unknown) => {
        // Subscription failed — the client will receive keepalives but no events.
        // Log so operators can see the degradation instead of debugging silently.
        logger.warn("Redis subscribe failed", { userId, err });
      });

      subscriber.on("message", (_channel: string, message: string) => {
        send(message);
      });

      // Keepalive
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          cleanup();
        }
      }, KEEPALIVE_MS);

      // Timeout
      const timeout = setTimeout(() => {
        cleanup();
      }, MAX_DURATION_MS);

      function cleanup() {
        releaseOnce();
        clearInterval(keepalive);
        clearTimeout(timeout);
        subscriber.unsubscribe().catch(() => undefined);
        subscriber.quit().catch(() => undefined);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }

      // Handle client disconnect
      event.request.signal.addEventListener("abort", cleanup);
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream"
    }
  });
};
