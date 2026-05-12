import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { ForbiddenError, contestDomain } from "@nojv/domain";

import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { loadPlagiarismPair } from "$lib/server/plagiarism-pair";

const { getContestDetail } = contestDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const contest = await getContestDetail(event.params.contestId, {
    userId: actor.userId,
    platformRole: event.locals.sessionUser?.platformRole ?? null,
    now: new Date(),
  });
  if (!contest.isManager) {
    throw new ForbiddenError("Only contest organizers can view plagiarism diff.");
  }

  return await loadPlagiarismPair({
    pairId: event.params.pairId,
    target: { type: "contest", id: contest.id },
    flagContext: "contest",
  });
});
