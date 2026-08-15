import type { PageServerLoad } from "./$types";

import { adminDomain } from "@nojv/application";

export const load: PageServerLoad = async (event) => {
  const { actor } = await event.parent();
  return { courses: await adminDomain.listAllCoursesForAdmin(actor) };
};
