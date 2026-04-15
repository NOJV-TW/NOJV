import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { examDomain } from "@nojv/domain";

const bodySchema = z.object({
  examId: z.string().min(1)
});

/**
 * POST /api/exam-session/start
 *
 * Begin (or re-enter) an exam session for the calling user. Idempotent:
 * a second call for the same exam returns the existing session with a
 * 200, while a fresh start returns 201. The domain helper enforces
 * enrolment + exam-window + cross-exam mutual exclusion, and maps to:
 *   - 403 ForbiddenError  → not enrolled in the exam's course
 *   - 404 NotFoundError   → exam missing or not published
 *   - 410 HttpError       → exam not started (grace exceeded) / ended
 *   - 409 ConflictError   → another exam already active
 */
export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const body = bodySchema.parse(await event.request.json());

  const result = await examDomain.session.startSessionWithGate(actor, {
    examId: body.examId,
    ipPin: event.getClientAddress()
  });

  return json(
    {
      sessionId: result.session.id,
      examId: result.session.examId,
      startedAt: result.session.startedAt.toISOString(),
      endsAt: result.exam.endsAt.toISOString()
    },
    { status: result.created ? 201 : 200 }
  );
});
