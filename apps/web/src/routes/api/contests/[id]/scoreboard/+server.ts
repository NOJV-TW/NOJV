import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { getActorContext } from "$lib/server/auth";
import { contestDomain } from "@nojv/application";
import { apiHandler } from "$lib/server/shared/api-handler";

const { canViewLiveContestScoreboard, getScoreboard } = contestDomain;

export const GET: RequestHandler = apiHandler(async (event) => {
  const { id } = event.params;
  if (!id) return json({ message: "Missing contest id." }, { status: 400 });

  const actor = getActorContext(event);
  const canSeeLive = await canViewLiveContestScoreboard(id, actor);

  const scoreboard = await getScoreboard(id, { canSeeLive });

  return json(scoreboard);
});
