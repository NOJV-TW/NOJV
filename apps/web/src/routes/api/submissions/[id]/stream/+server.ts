import type { RequestHandler } from "./$types";
import { getActorContext, hasActorUsername } from "$lib/server/auth";
import { acquireSseSlot, releaseSseSlot } from "$lib/server/shared/sse-slot";
import { apiRateLimiter } from "$lib/server/shared/rate-limiter";
import { getClientIp } from "$lib/server/shared/client-ip";
import { submissionDomain } from "@nojv/domain";
import { submissionResultSchema } from "@nojv/core";

const { getSubmissionForUser, getVerdictDetail, querySubmissionStatus, stripStaffFeedback } =
  submissionDomain;

function sanitizeVerdictDetail(raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;
  const parsed = submissionResultSchema.safeParse(raw);
  return parsed.success ? stripStaffFeedback(parsed.data) : raw;
}

async function loadDetail(
  submission: Awaited<ReturnType<typeof getSubmissionForUser>>,
): Promise<unknown> {
  if (!submission.verdictDetailStorageKey) return null;
  return getVerdictDetail(submission.id);
}

const POLL_INTERVAL_MS = 1000;
const MAX_DURATION_MS = 600_000;
const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export const GET: RequestHandler = async (event) => {
  const actor = getActorContext(event);
  if (!actor) return new Response("Authentication required.", { status: 401 });
  if (!hasActorUsername(actor))
    return new Response("Complete your profile first.", { status: 403 });

  const { id: submissionId } = event.params;
  const userId = actor.userId;
  const isAdmin = actor.platformRole === "admin";

  const ip = getClientIp(event);
  try {
    await apiRateLimiter.consume(ip);
  } catch {
    return new Response("Too many requests", { status: 429 });
  }

  try {
    await getSubmissionForUser(submissionId, userId, isAdmin);
  } catch {
    return new Response("Submission not found.", { status: 404 });
  }

  if (!acquireSseSlot("submission", userId)) {
    return new Response("Too many concurrent connections", { status: 429 });
  }

  let released = false;
  function releaseOnce() {
    if (!released) {
      released = true;
      releaseSseSlot("submission", userId);
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const startTime = Date.now();

      event.request.signal.addEventListener("abort", () => {
        releaseOnce();
        try {
          controller.close();
        } catch {
          // ignore: controller already closed
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
              const submission = await getSubmissionForUser(submissionId, userId, isAdmin);
              const detail = await loadDetail(submission);
              send({
                result: sanitizeVerdictDetail(detail),
                status: submission.status,
                submissionId: submission.id,
              });
              break;
            }
          } catch {
            const submission = await getSubmissionForUser(submissionId, userId, isAdmin);
            const detail = await loadDetail(submission);
            send({
              result: sanitizeVerdictDetail(detail),
              status: submission.status,
              submissionId: submission.id,
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
