import { error } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";

export const load: LayoutServerLoad = (event) => {
  const actor = requireAuth(event);

  if (actor.platformRole !== "admin") {
    error(403, "Admin access required.");
  }

  return { actor };
};
