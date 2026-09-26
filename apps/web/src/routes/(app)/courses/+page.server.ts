import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { canCreateCourse, courseDomain } from "@nojv/application";

const { listForUserWithCards } = courseDomain;

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);
  if (actor.platformRole === "admin") redirect(303, "/admin/courses");
  const canCreate = canCreateCourse(actor.platformRole);
  const { enrolled, managing } = await listForUserWithCards(actor.userId);
  return { enrolled, managing, canCreate };
};
