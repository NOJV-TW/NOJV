import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { getActorContext } from "$lib/server/auth";
import { contestDomain } from "@nojv/application";

const { canViewLiveContestScoreboard, getScoreboardChart } = contestDomain;
import { apiHandler } from "$lib/server/shared/api-handler";

export const GET: RequestHandler = apiHandler(async (event) => {
  const { id } = event.params;
  if (!id) return json({ message: "Missing contest id." }, { status: 400 });

  const topN = Math.min(
    Math.max(1, Number.parseInt(event.url.searchParams.get("topN") ?? "10", 10) || 10),
    50,
  );

  const actor = getActorContext(event);
  const canSeeLive = await canViewLiveContestScoreboard(id, actor);

  const chart = await getScoreboardChart(id, topN, { canSeeLive });

  return json(chart);
});
