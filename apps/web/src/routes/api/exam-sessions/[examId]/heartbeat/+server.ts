import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { NotFoundError, requireApiAuth } from "$lib/server/auth";
import { examHeartbeatMissTotal, heartbeatGapBucket } from "$lib/server/metrics";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { examDomain } from "@nojv/domain";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const { examId } = event.params;
  if (!examId) return json({ message: "Missing examId." }, { status: 400 });

  try {
    const result = await examDomain.session.heartbeatWithThrottle(actor.userId, examId);
    const gapSec = (Date.now() - result.previousHeartbeatAt.getTime()) / 1000;
    const bucket = heartbeatGapBucket(gapSec);
    if (bucket) {
      examHeartbeatMissTotal.add(1, { gap_bucket: bucket });
    }
    return json({
      ok: true,
      released: false,
      lastHeartbeatAt: result.session.lastHeartbeatAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return json({ ok: true, released: true });
    }
    throw error;
  }
});
