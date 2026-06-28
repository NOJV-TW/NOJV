import { subscribeSse } from "$lib/server/shared/sse-hub";
import {
  sseConnectionDuration,
  sseConnectionDroppedTotal,
  type SseCloseReason,
} from "$lib/server/metrics";
import {
  acquireSseSlot,
  releaseSseSlot,
  type SseStreamType,
} from "$lib/server/shared/sse-slot";

const MAX_DURATION_MS = 3_500_000;
const KEEPALIVE_MS = 30_000;

interface CreateSseResponseOptions {
  channels: string[];
  slotType: SseStreamType;
  userId: string;
  redisUrl: string;
  request: Request;
}

export function createSseResponse(options: CreateSseResponseOptions): Response {
  const { channels, slotType, userId, redisUrl, request } = options;

  if (!acquireSseSlot(slotType, userId)) {
    return new Response("Too many concurrent connections", { status: 429 });
  }

  let released = false;
  function releaseOnce() {
    if (!released) {
      released = true;
      releaseSseSlot(slotType, userId);
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

      const unsubscribe = subscribeSse(redisUrl, channels, (_channel, message) => {
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
        unsubscribe();
        closeController();

        sseConnectionDuration.record((performance.now() - startMs) / 1000, {
          close_reason: reason,
        });
        if (reason === "controller_error") {
          sseConnectionDroppedTotal.add(1);
        }
      }

      request.signal.addEventListener("abort", () => cleanup("client_abort"));
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
}
