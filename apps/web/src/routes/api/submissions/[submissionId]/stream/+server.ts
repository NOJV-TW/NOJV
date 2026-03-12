import type { RequestHandler } from "./$types";

import { getActorContext, hasActorHandle } from "$lib/server/auth";
import { getSubmissionForUser } from "$lib/server/submission/queries";

const TERMINAL_STATUSES = new Set([
  "accepted",
  "compilation_error",
  "memory_limit_exceeded",
  "runtime_error",
  "system_error",
  "time_limit_exceeded",
  "wrong_answer"
]);

const POLL_INTERVAL_MS = 1000;
const MAX_DURATION_MS = 600_000;

export const GET: RequestHandler = async (event) => {
  const actor = getActorContext(event);
  if (!actor) {
    return new Response("Authentication required.", { status: 401 });
  }
  if (!hasActorHandle(actor)) {
    return new Response("Complete your profile first.", { status: 403 });
  }

  const { submissionId } = event.params;
  const userId = actor.userId;
  const isAdmin = actor.platformRole === "admin";

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const startTime = Date.now();

      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        // Initial ownership check
        await getSubmissionForUser(submissionId, userId, isAdmin);

        while (Date.now() - startTime < MAX_DURATION_MS) {
          const submission = await getSubmissionForUser(submissionId, userId, isAdmin);

          send({
            result: submission.verdictDetail,
            status: submission.status,
            submissionId: submission.id
          });

          if (TERMINAL_STATUSES.has(submission.status)) {
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      } catch {
        send({ error: "Submission not found." });
      }

      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream"
    }
  });
};
