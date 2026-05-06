import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { NotFoundError, requireApiAuth } from "$lib/server/auth";
import { examHeartbeatMissTotal, heartbeatGapBucket } from "$lib/server/metrics";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { examDomain } from "@nojv/domain";

const bodySchema = z.object({
  examId: z.string().min(1),
});

// Returns 204 when the caller has no active session so the client can treat it as "released".
export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const body = bodySchema.parse(await event.request.json());

  try {
    const result = await examDomain.session.heartbeatWithThrottle(actor.userId, body.examId);
    const gapSec = (Date.now() - result.previousHeartbeatAt.getTime()) / 1000;
    const bucket = heartbeatGapBucket(gapSec);
    if (bucket) {
      examHeartbeatMissTotal.add(1, { gap_bucket: bucket });
    }
    return json({
      ok: true,
      lastHeartbeatAt: result.session.lastHeartbeatAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return new Response(null, { status: 204 });
    }
    throw error;
  }
});
