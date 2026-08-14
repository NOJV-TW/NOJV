import type { PageServerLoad } from "./$types";

import { adminDomain } from "@nojv/application";

export const load: PageServerLoad = async (event) => {
  const { actor } = await event.parent();
  return { contests: await adminDomain.listAllContestsForAdmin(actor) };
};
