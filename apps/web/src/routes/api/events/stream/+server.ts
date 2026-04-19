import type { RequestHandler } from "./$types";
import { getActorContext, hasActorUsername } from "$lib/server/auth";
import { createSubscriber, keys } from "@nojv/redis";
import { userChannel } from "@nojv/core";
import { clarificationDomain } from "@nojv/domain";
import { createLogger } from "$lib/server/logger";
import { z } from "zod";

const CLARIFICATION_CONTEXT_TYPES = new Set(["contest", "exam", "assignment"] as const);

type ClarificationContextType = "contest" | "exam" | "assignment";

interface ClarificationSub {
  contextType: ClarificationContextType;
  contextId: string;
}

/**
 * Parse `clarificationSub` query params in `contextType:contextId` form.
 * Silently drops malformed entries — a malformed subscription request
 * does not break the whole SSE connection.
 */
function parseClarificationSubs(url: URL): ClarificationSub[] {
  const out: ClarificationSub[] = [];
  const seen = new Set<string>();
  for (const raw of url.searchParams.getAll("clarificationSub")) {
    const idx = raw.indexOf(":");
    if (idx <= 0 || idx === raw.length - 1) continue;
    const contextType = raw.slice(0, idx);
    const contextId = raw.slice(idx + 1);
    if (!CLARIFICATION_CONTEXT_TYPES.has(contextType as ClarificationContextType)) continue;
    if (contextId.length === 0 || contextId.length > 200) continue;
    const key = `${contextType}:${contextId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ contextType: contextType as ClarificationContextType, contextId });
  }
  return out;
}

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

export const GET: RequestHandler = async (event) => {
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

  // Authorize each requested clarification channel. We check both
  // "can ask" (participant) and "can answer" (staff) because either
  // role legitimately needs the live feed. Unauthorized subs are
  // dropped silently — the rest of the connection continues.
  const requestedSubs = parseClarificationSubs(event.url);
  const authorizedClarChannels: string[] = [];
  for (const sub of requestedSubs) {
    const [canAsk, canAnswer] = await Promise.all([
      clarificationDomain.canAskClarification(actor, sub.contextType, sub.contextId),
      clarificationDomain.canAnswerInContext(actor, sub.contextType, sub.contextId)
    ]);
    if (canAsk || canAnswer) {
      authorizedClarChannels.push(keys.clarificationChannel(sub.contextType, sub.contextId));
    }
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
      const channels = [
        userChannel(userId),
        keys.notificationChannel(userId),
        ...authorizedClarChannels
      ];

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
