import type { PageServerLoad } from "./$types";

import { getActorContext } from "$lib/server/auth";
import { contestDomain } from "@nojv/domain";

const { getScoreboard, getScoreboardChart } = contestDomain;

export const load: PageServerLoad = async (event) => {
  const { contestId } = event.params;
  const actor = getActorContext(event);

  const canUnfreeze =
    actor != null && (actor.platformRole === "admin" || actor.platformRole === "teacher");

  const [scoreboard, chart] = await Promise.all([
    getScoreboard(contestId, { isPrivileged: canUnfreeze }),
    getScoreboardChart(contestId, 10)
  ]);

  return {
    canUnfreeze,
    chart,
    contestId,
    scoreboard
  };
};
