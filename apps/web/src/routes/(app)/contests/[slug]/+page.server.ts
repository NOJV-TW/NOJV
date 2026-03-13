import { error } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";
import { getContestDetail } from "$lib/server/contest/queries";

export const load: PageServerLoad = async ({ params }) => {
  const contest = await getContestDetail(params.slug);

  if (!contest) {
    error(404, "Contest not found");
  }

  return { contest };
};
