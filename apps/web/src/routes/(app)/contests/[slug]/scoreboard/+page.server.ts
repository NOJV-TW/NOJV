import type { PageServerLoad } from "./$types";

import { getActorContext } from "$lib/server/auth";
import { getScoreboard, getScoreboardChart } from "$lib/server/contest/scoreboard";

export const load: PageServerLoad = async (event) => {
  const { slug } = event.params;
  const actor = getActorContext(event);

  const canUnfreeze =
    actor != null && (actor.platformRole === "admin" || actor.platformRole === "teacher");

  const [scoreboard, chart] = await Promise.all([
    getScoreboard(slug),
    getScoreboardChart(slug, 10)
  ]);

  return {
    canUnfreeze,
    chart,
    contestSlug: slug,
    scoreboard
  };
};
