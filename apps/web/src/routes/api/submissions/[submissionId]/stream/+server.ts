import type { RequestHandler } from "./$types";
import { getActorContext, hasActorUsername } from "$lib/server/auth";
import { getSubmissionForUser } from "$lib/server/submission/queries";
import { getTemporalClient } from "@nojv/temporal";

const POLL_INTERVAL_MS = 1000;
const MAX_DURATION_MS = 600_000;
const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export const GET: RequestHandler = (event) => {
  const actor = getActorContext(event);
  if (!actor) return new Response("Authentication required.", { status: 401 });
  if (!hasActorUsername(actor)) return new Response("Complete your profile first.", { status: 403 });

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
        const client = await getTemporalClient();
        const handle = client.workflow.getHandle(`judge-${submissionId}`);

        while (Date.now() - startTime < MAX_DURATION_MS) {
          try {
            const status = await handle.query<string>("getStatus");
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
