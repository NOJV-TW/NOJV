import type { RequestHandler } from "./$types";
import { getActorContext, hasActorUsername } from "$lib/server/auth";
import { keys } from "@nojv/redis";
import { subscribeSse } from "$lib/server/shared/sse-hub";
import { contestDomain } from "@nojv/domain";
import {
  sseConnectionDuration,
  sseConnectionDroppedTotal,
  type SseCloseReason,
} from "$lib/server/metrics";
import { acquireSseSlot, releaseSseSlot } from "$lib/server/shared/sse-slot";
import { apiRateLimiter } from "$lib/server/shared/rate-limiter";
import { getClientIp } from "$lib/server/shared/client-ip";
import { z } from "zod";

const sseEnvSchema = z.object({
  REDIS_URL: z.url(),
});

const MAX_DURATION_MS = 600_000;
const KEEPALIVE_MS = 30_000;

export const GET: RequestHandler = async (event) => {
  const actor = getActorContext(event);
  if (!actor || !hasActorUsername(actor)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const envResult = sseEnvSchema.safeParse(process.env);
  if (!envResult.success) {
    return new Response("SSE not configured", { status: 503 });
  }

  const ip = getClientIp(event);
  try {
    await apiRateLimiter.consume(ip);
  } catch {
    return new Response("Too many requests", { status: 429 });
  }

  const { contestId } = event.params;
  const userId = actor.userId;
  const redisUrl = envResult.data.REDIS_URL;

  let detail;
  try {
    detail = await contestDomain.getContestDetail(contestId, {
      now: new Date(),
      platformRole: actor.platformRole,
      userId,
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (detail.problemsHidden) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!acquireSseSlot("scoreboard", userId)) {
    return new Response("Too many concurrent connections", { status: 429 });
  }

  let released = false;
  function releaseOnce() {
    if (!released) {
      released = true;
      releaseSseSlot("scoreboard", userId);
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const startMs = performance.now();
      let closed = false;

      function send(data: string) {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          return;
        }
      }

      function closeController() {
        try {
          controller.close();
        } catch {
          return;
        }
      }

      const unsubscribe = subscribeSse(
        redisUrl,
        [keys.contestChannel(contestId)],
        (_channel, message) => {
          send(message);
        },
      );

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          cleanup("controller_error");
        }
      }, KEEPALIVE_MS);

      const timeout = setTimeout(() => {
        cleanup("timeout");
      }, MAX_DURATION_MS);

      function cleanup(reason: SseCloseReason) {
        if (closed) return;
        closed = true;
        releaseOnce();
        clearInterval(keepalive);
        clearTimeout(timeout);
        unsubscribe();
        closeController();

        sseConnectionDuration.record((performance.now() - startMs) / 1000, {
          close_reason: reason,
        });
        if (reason === "controller_error") {
          sseConnectionDroppedTotal.add(1);
        }
      }

      event.request.signal.addEventListener("abort", () => cleanup("client_abort"));
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
};
