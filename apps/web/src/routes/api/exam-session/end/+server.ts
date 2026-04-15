import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { ForbiddenError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { examDomain } from "@nojv/domain";

/**
 * `reason === "submitted"` → the caller's own session; `userId` is
 * optional (and must equal the caller if provided).
 * `reason === "released_by_instructor"` → `userId` is required and
 * must be a course member; the caller must be staff.
 */
const bodySchema = z.discriminatedUnion("reason", [
  z.object({
    reason: z.literal("submitted"),
    examId: z.string().min(1),
    userId: z.string().min(1).optional()
  }),
  z.object({
    reason: z.literal("released_by_instructor"),
    examId: z.string().min(1),
    userId: z.string().min(1)
  })
]);

/**
 * POST /api/exam-session/end
 *
 * Close an exam session. Two reasons supported:
 *   - `submitted`              → student finishing their own work; the
 *     target must be the caller. Delegates to `endSession`.
 *   - `released_by_instructor` → teacher/TA releasing a student. The
 *     target is required. Delegates to `releaseSessionAsInstructor`.
 *
 * Maps domain errors to:
 *   - 403 ForbiddenError → wrong role for the chosen reason
 *   - 404 NotFoundError  → no active session for the target user
 */
export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const body = bodySchema.parse(await event.request.json());

  if (body.reason === "submitted") {
    if (body.userId && body.userId !== actor.userId) {
      throw new ForbiddenError("You can only submit your own exam session.");
    }

    const updated = await examDomain.session.endSession(actor, {
      examId: body.examId,
      reason: "submitted"
    });

    return json({
      sessionId: updated.id,
      endedAt: (updated.endedAt ?? new Date()).toISOString(),
      releaseReason: updated.releaseReason
    });
  }

  // reason === "released_by_instructor" — schema has already enforced
  // that `userId` is present in this branch.
  const updated = await examDomain.session.releaseSessionAsInstructor(actor, {
    examId: body.examId,
    targetUserId: body.userId
  });

  return json({
    sessionId: updated.id,
    endedAt: (updated.endedAt ?? new Date()).toISOString(),
    releaseReason: updated.releaseReason
  });
});
