import { redirect } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";
import { canCreateCourse, requireAuth } from "$lib/server/auth";

export const load: PageServerLoad = (event) => {
  const actor = requireAuth(event);
  if (!canCreateCourse(actor.platformRole)) {
    redirect(303, "/courses");
  }
  return {};
};
