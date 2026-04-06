import type { RequestHandler } from "./$types";
import { getActorContext, hasActorUsername } from "$lib/server/auth";
import { submissionDomain } from "@nojv/domain";

const { getSubmissionForUser, querySubmissionStatus } = submissionDomain;

const POLL_INTERVAL_MS = 1000;
const MAX_DURATION_MS = 600_000;
const TERMINAL_STATUSES = new Set(["completed", "failed"]);
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
  if (!actor) return new Response("Authentication required.", { status: 401 });
  if (!hasActorUsername(actor))
    return new Response("Complete your profile first.", { status: 403 });

  const { submissionId } = event.params;
  const userId = actor.userId;
  const isAdmin = actor.platformRole === "admin";

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
    async start(controller) {
      const encoder = new TextEncoder();
      const startTime = Date.now();

      // Handle client disconnect
      event.request.signal.addEventListener("abort", () => {
        releaseOnce();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });

      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        while (Date.now() - startTime < MAX_DURATION_MS) {
          try {
            const status = await querySubmissionStatus(submissionId);
            send({ status, submissionId });

            if (TERMINAL_STATUSES.has(status)) {
              // Fetch final result from DB for complete details
              const submission = await getSubmissionForUser(submissionId, userId, isAdmin);
              send({
                result: submission.verdictDetail,
                status: submission.status,
                submissionId: submission.id
              });
              break;
            }
          } catch {
            // Workflow might have already completed - fall back to DB
            const submission = await getSubmissionForUser(submissionId, userId, isAdmin);
            send({
              result: submission.verdictDetail,
              status: submission.status,
              submissionId: submission.id
            });
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      } catch {
        send({ error: "Submission not found." });
      }
      releaseOnce();
      controller.close();
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
