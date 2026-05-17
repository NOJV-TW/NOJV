import { fail } from "@sveltejs/kit";

import { contestDomain, virtualContestDomain } from "@nojv/domain";

import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getContestDetail } = contestDomain;
const { startVirtualContest, getVirtualContestForUser, getVirtualContestScoreboard } =
  virtualContestDomain;

/**
 * Virtual-contest dashboard. Lets a user replay a past contest on their own
 * clock. The route is reachable for any published contest, but the "start"
 * action only succeeds once the contest has ended (enforced in the domain).
 */
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
  start: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    try {
      await startVirtualContest(actor, event.params.contestId);
    } catch (err) {
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }
    return { started: true };
  }),
};
