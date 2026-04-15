import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { NotFoundError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { examDomain } from "@nojv/domain";

const bodySchema = z.object({
  examId: z.string().min(1)
});

/**
 * POST /api/exam-session/heartbeat
 *
 * Refresh `lastHeartbeatAt` on the caller's active session for the
 * given exam. The audit-log `heartbeat` event is rate-limited to one
 * per minute per session by `heartbeatWithThrottle`, so a 15-30s
 * client interval will not flood `ExamSessionEvent`.
 *
 * Returns 204 No Content if the caller has no active session for the
 * exam — the client treats this as "you've been released, redirect
 * upstream", which is preferable to a noisy 404.
 */
export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const body = bodySchema.parse(await event.request.json());

  try {
    const result = await examDomain.session.heartbeatWithThrottle(actor.userId, body.examId);
    return json({
      ok: true,
      lastHeartbeatAt: result.session.lastHeartbeatAt.toISOString()
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return new Response(null, { status: 204 });
    }
    throw error;
  }
});
