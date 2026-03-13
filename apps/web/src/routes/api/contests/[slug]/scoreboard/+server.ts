import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { getActorContext } from "$lib/server/auth";
import { getScoreboard } from "$lib/server/contest/scoreboard";
import { apiHandler } from "$lib/server/shared/api-handler";

export const GET: RequestHandler = apiHandler(async (event) => {
  const { slug } = event.params;
  if (!slug) return json({ message: "Missing contest slug." }, { status: 400 });

  const actor = getActorContext(event);
  const unfrozen = event.url.searchParams.get("unfrozen") === "true";

  // Only admin/teacher can see unfrozen view
  const canUnfreeze =
    actor != null &&
    (actor.platformRole === "admin" || actor.platformRole === "teacher");

  const scoreboard = await getScoreboard(slug, {
    unfrozen: unfrozen && canUnfreeze
  });

  return json(scoreboard);
});
