import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { ForbiddenError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { examDomain } from "@nojv/domain";

const bodySchema = z.discriminatedUnion("reason", [
  z.object({
    reason: z.literal("submitted"),
    examId: z.string().min(1),
    userId: z.string().min(1).optional(),
  }),
  z.object({
    reason: z.literal("released_by_instructor"),
    examId: z.string().min(1),
    userId: z.string().min(1),
  }),
]);

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const body = bodySchema.parse(await event.request.json());

  if (body.reason === "submitted") {
    if (body.userId && body.userId !== actor.userId) {
      throw new ForbiddenError("You can only submit your own exam session.");
    }

    const updated = await examDomain.session.endSession(actor, {
      examId: body.examId,
      reason: "submitted",
    });

    return json({
      sessionId: updated.id,
      endedAt: (updated.endedAt ?? new Date()).toISOString(),
      releaseReason: updated.releaseReason,
    });
  }

  const updated = await examDomain.session.releaseSessionAsInstructor(actor, {
    examId: body.examId,
    targetUserId: body.userId,
  });

  return json({
    sessionId: updated.id,
    endedAt: (updated.endedAt ?? new Date()).toISOString(),
    releaseReason: updated.releaseReason,
  });
});
