import type { PageServerLoad } from "./$types";
import { canCreateCourse, requireAuth } from "$lib/server/auth";
import { courseDomain } from "@nojv/domain";

const { listForUserWithCards } = courseDomain;

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);
  const canCreate = canCreateCourse(actor.platformRole);
  const { enrolled, managing } = await listForUserWithCards(actor.userId);
  return { enrolled, managing, canCreate };
};
