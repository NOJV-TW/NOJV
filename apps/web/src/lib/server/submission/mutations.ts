// Re-export from domain — original logic has been moved to @nojv/domain
// Thin adapter: extracts clientIp from Request before forwarding to domain
import type { SubmissionDraft } from "@nojv/core";
import { submissionDomain, getClientIp } from "@nojv/domain";

import type { CompletedActorContext } from "../auth";

export async function createQueuedSubmissionRecord(
  payload: SubmissionDraft,
  actor: CompletedActorContext,
  request: Request
) {
  const clientIp = getClientIp(request);
  return submissionDomain.createQueuedSubmissionRecord(payload, {
    displayName: actor.displayName,
    email: actor.email,
    username: actor.username,
    platformRole: actor.platformRole,
    userId: actor.userId
  }, clientIp);
}
