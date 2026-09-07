import { contestDomain, virtualContestDomain } from "@nojv/application";

import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { withAction } from "$lib/server/shared/action-handlers";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getContestDetail } = contestDomain;
const { startVirtualContest, getVirtualContestForUser, getVirtualContestScoreboard } =
  virtualContestDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const { contestId } = event.params;
  const now = new Date();

  const contest = await getContestDetail(contestId, {
    userId: actor.userId,
    platformRole: actor.platformRole,
    now,
  });

  const contestEnded = now >= new Date(contest.endsAt);

  const virtual = await getVirtualContestForUser(contestId, actor.userId, now);
  const scoreboard = virtual
    ? await getVirtualContestScoreboard(contestId, actor.userId)
    : null;

  return {
    contestId,
    contestTitle: contest.title,
    contestEnded,
    virtual,
    scoreboard,
  };
});

export const actions: Actions = {
  start: withAction(async (event) => {
    const actor = requireAuth(event);
    await startVirtualContest(actor, event.params.contestId);
    return { started: true };
  }),
};
