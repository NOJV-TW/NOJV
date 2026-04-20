import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { getActorContext } from "$lib/server/auth";
import { contestDomain } from "@nojv/domain";

const { getScoreboard } = contestDomain;
import { apiHandler } from "$lib/server/shared/api-handler";

export const GET: RequestHandler = apiHandler(async (event) => {
  const { contestId } = event.params;
  if (!contestId) return json({ message: "Missing contest id." }, { status: 400 });

  const actor = getActorContext(event);
  const unfrozen = event.url.searchParams.get("unfrozen") === "true";

  // Only admin/teacher can see unfrozen view
  const canUnfreeze =
    actor != null && (actor.platformRole === "admin" || actor.platformRole === "teacher");

  const scoreboard = await getScoreboard(contestId, {
    isPrivileged: canUnfreeze,
    unfrozen: unfrozen && canUnfreeze,
  });

  return json(scoreboard);
});
