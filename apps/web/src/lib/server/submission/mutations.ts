// Thin adapter: wraps submissionDomain.createQueuedSubmissionRecord so the
// route handler doesn't need to re-plumb actor fields each call. The caller
// is responsible for resolving the client IP via
// `$lib/server/shared/client-ip.getClientIp(event)` — see that file for the
// Cloudflare trust model.
import type { SubmissionDraft } from "@nojv/core";
import { submissionDomain } from "@nojv/domain";

import type { CompletedActorContext } from "../auth";

export async function createQueuedSubmissionRecord(
  payload: SubmissionDraft,
  actor: CompletedActorContext,
  clientIp: string
) {
  return submissionDomain.createQueuedSubmissionRecord(
    payload,
    {
      displayName: actor.displayName,
      email: actor.email,
      username: actor.username,
      platformRole: actor.platformRole,
      userId: actor.userId
    },
    clientIp
  );
}
