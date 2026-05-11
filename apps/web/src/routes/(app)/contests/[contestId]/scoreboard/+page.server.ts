import { redirect } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";

import { getActorContext } from "$lib/server/auth";
import { contestDomain } from "@nojv/domain";

const { getContestDetail, getScoreboard, getScoreboardChart } = contestDomain;

export const load: PageServerLoad = async (event) => {
  const { contestId } = event.params;
  const actor = getActorContext(event);

  const canUnfreeze =
    actor != null && (actor.platformRole === "admin" || actor.platformRole === "teacher");

  const detail = await getContestDetail(contestId, {
    now: new Date(),
    platformRole: actor?.platformRole ?? null,
    userId: actor?.userId ?? null,
  });

  // Bounce non-managers off the scoreboard before kickoff — the scoreboard
  // payload still carries problem titles, which would leak content the
  // contest detail page hides via `problemsHidden`.
  if (detail.problemsHidden) {
    redirect(303, `/contests/${contestId}`);
  }

  const [scoreboard, chart] = await Promise.all([
    getScoreboard(contestId, { isPrivileged: canUnfreeze }),
    getScoreboardChart(contestId, 10),
  ]);

  return {
    canUnfreeze,
    chart,
    contestId,
    scoreboard,
  };
};
