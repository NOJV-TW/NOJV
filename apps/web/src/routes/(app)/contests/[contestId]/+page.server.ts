import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { clarificationDomain, contestDomain, scoreOverrideDomain } from "@nojv/domain";

import { getActorContext, hasActorUsername } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getContestDetail, listContestParticipantsWithUser } = contestDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const { params, locals } = event;
  const now = new Date();
  const user = locals.user;

  const contest = await getContestDetail(params.contestId, {
    userId: user?.id ?? null,
    platformRole: locals.sessionUser?.platformRole ?? null,
    now,
  });

  // Staff-only data for the score-override drawer. Students don't see the
  // button so we skip the extra fetches entirely.
  let canSetOverride = false;
  let overrideStudents: { id: string; username: string; name: string }[] = [];

  if (contest.isManager) {
    const actor = getActorContext(event);
    if (actor && hasActorUsername(actor)) {
      const [allowed, participants] = await Promise.all([
        scoreOverrideDomain.canSetScoreOverride(actor, "contest", contest.id),
        listContestParticipantsWithUser(contest.id),
      ]);
      canSetOverride = allowed;
      overrideStudents = participants.map((p) => ({
        id: p.user.id,
        username: p.user.username ?? "",
        name: p.user.name,
      }));
    }
  }

  const actor = getActorContext(event);
  let canAskClar = false;
  let canAnswerClar = false;
  let canViewClar = false;
  if (actor && hasActorUsername(actor)) {
    [canAskClar, canAnswerClar, canViewClar] = await Promise.all([
      clarificationDomain.canAskClarification(actor, "contest", contest.id),
      clarificationDomain.canAnswerInContext(actor, "contest", contest.id),
      clarificationDomain.canViewClarifications(actor, "contest", contest.id),
    ]);
  }

  return {
    contest,
    canSetOverride,
    overrideStudents,
    clarification: {
      canAsk: canAskClar,
      canAnswer: canAnswerClar,
      canView: canViewClar,
    },
  };
});
