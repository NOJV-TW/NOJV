import { fail, redirect } from "@sveltejs/kit";

import type { Actions, PageServerLoad } from "./$types";

import { getActorContext, requireAuth } from "$lib/server/auth";
import { withRateLimit } from "$lib/server/shared/action-handlers";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { contestDomain } from "@nojv/domain";

const {
  canViewLiveContestScoreboard,
  getContestDetail,
  getScoreboard,
  getScoreboardChart,
  unfreezeContest,
} = contestDomain;

export const load: PageServerLoad = handleLoad(async (event) => {
  const { contestId } = event.params;
  const actor = getActorContext(event);

  const canSeeLive = await canViewLiveContestScoreboard(contestId, actor);

  const detail = await getContestDetail(contestId, {
    now: new Date(),
    platformRole: actor?.platformRole ?? null,
    userId: actor?.userId ?? null,
  });

  if (detail.problemsHidden) {
    redirect(303, `/contests/${contestId}`);
  }

  const [scoreboard, chart] = await Promise.all([
    getScoreboard(contestId, { canSeeLive }),
    getScoreboardChart(contestId, 10),
  ]);

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
