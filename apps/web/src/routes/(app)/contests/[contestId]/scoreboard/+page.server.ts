import { fail, redirect } from "@sveltejs/kit";

import type { Actions, PageServerLoad } from "./$types";

import { getActorContext, requireAuth } from "$lib/server/auth";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { contestNotStarted } from "$lib/utils/scoreboard";
import { contestDomain } from "@nojv/application";

const {
  canViewLiveContestScoreboard,
  getContestDetail,
  getScoreboard,
  getScoreboardChart,
  unfreezeContest,
} = contestDomain;

export const load: PageServerLoad = handleLoad(async (event) => {
  const { contestId } = event.params;
  event.depends("contest:scoreboard");
  const actor = getActorContext(event);

  const detail = await getContestDetail(contestId, {
    now: new Date(),
    platformRole: actor?.platformRole ?? null,
    userId: actor?.userId ?? null,
  });

  if (contestNotStarted(detail.startsAt) && !detail.isManager) {
    redirect(303, `/contests/${contestId}`);
  }

  const canSeeLive = detail.isManager;

  const scoreboard = await getScoreboard(contestId, { canSeeLive });
  const chart = await getScoreboardChart(contestId, 10, {
    canSeeLive,
    precomputed: scoreboard,
  });

  return {
    canUnfreeze: canSeeLive,
    chart,
    contestId,
    scoreboard,
  };
});

export const actions = {
  unfreeze: withRateLimit(async (event) => {
    const actor = requireAuth(event);
    const allowed = await canViewLiveContestScoreboard(event.params.contestId, actor);
    if (!allowed) {
      return fail(403, { error: "Only the contest organizer or an admin can unfreeze." });
    }

    const result = await unfreezeContest(event.params.contestId);
    if (!result) {
      return fail(404, { error: "Contest not found." });
    }

    return { success: true };
  }),
} satisfies Actions;
