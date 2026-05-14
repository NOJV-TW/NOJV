import type { RequestHandler } from "./$types";
import { getActorContext, hasActorUsername } from "$lib/server/auth";
import { createSubscriber, keys } from "@nojv/redis";
import { clarificationDomain } from "@nojv/domain";
type ClarificationContext = clarificationDomain.ClarificationContext;
import { createLogger } from "$lib/server/logger";
import {
  sseConnectionDuration,
  sseConnectionDroppedTotal,
  type SseCloseReason,
} from "$lib/server/metrics";
import { acquireSseSlot, releaseSseSlot } from "$lib/server/shared/sse-slot";
import { z } from "zod";

const CLARIFICATION_CONTEXT_TYPES = new Set(["contest", "exam", "assignment"] as const);

type ClarificationContextType = "contest" | "exam" | "assignment";

/**
 * Parse `clarificationSub` query params in `contextType:contextId` form
 * into discriminated `ClarificationContext` values. Silently drops
 * malformed entries — a malformed subscription request does not break
 * the whole SSE connection.
 *
 * The wire form on this endpoint stays flat (`contextType:contextId`)
 * for backward compatibility with the JS client; we lift it into the
 * discriminated union here at the boundary.
 */
function parseClarificationSubs(url: URL): ClarificationContext[] {
  const out: ClarificationContext[] = [];
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
    switch (contextType as ClarificationContextType) {
      case "contest":
        out.push({ type: "contest", contestId: contextId });
        break;
      case "exam":
        out.push({ type: "exam", examId: contextId });
        break;
      case "assignment":
        out.push({ type: "assignment", assignmentId: contextId });
        break;
    }
  }
  return out;
}

const logger = createLogger("sse-stream");

const sseEnvSchema = z.object({
  REDIS_URL: z.url(),
});

const MAX_DURATION_MS = 600_000; // 10 min
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

  const userId = actor.userId;
  const redisUrl = envResult.data.REDIS_URL;

  if (!acquireSseSlot("events", userId)) {
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
      clarificationDomain.canAskClarification(actor, sub),
      clarificationDomain.canAnswerInContext(actor, sub),
    ]);
    if (canAsk || canAnswer) {
      const { contextType, contextId } = clarificationDomain.toContextDbFields(sub);
      authorizedClarChannels.push(keys.clarificationChannel(contextType, contextId));
    }
  }

  let released = false;
  function releaseOnce() {
    if (!released) {
      released = true;
      releaseSseSlot("events", userId);
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const subscriber = createSubscriber(redisUrl);
      const channels = [
        keys.userChannel(userId),
        keys.notificationChannel(userId),
        ...authorizedClarChannels,
      ];

      const startMs = performance.now();
      let closed = false;
      // Subscribe failures keep the connection alive (keepalives, no events)
      // but flag the connection so cleanup attributes the close to the fault.
      let droppedFault = false;

      function send(data: string) {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // ignore: controller already closed
        }
      }

      subscriber.subscribe(...channels).catch((err: unknown) => {
        // Subscription failed — the client will receive keepalives but no events.
        // Log so operators can see the degradation instead of debugging silently.
        if (!droppedFault) {
          droppedFault = true;
          sseConnectionDroppedTotal.add(1);
        }
        logger.warn("Redis subscribe failed", { userId, err });
      });

      subscriber.on("message", (_channel: string, message: string) => {
        send(message);
      });

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
        subscriber.unsubscribe().catch(() => undefined);
        subscriber.quit().catch(() => undefined);
        try {
          controller.close();
        } catch {
          // ignore: controller already closed
        }

        const finalReason: SseCloseReason = droppedFault ? "subscribe_failed" : reason;
        sseConnectionDuration.record((performance.now() - startMs) / 1000, {
          close_reason: finalReason,
        });
        if (reason === "controller_error" && !droppedFault) {
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
