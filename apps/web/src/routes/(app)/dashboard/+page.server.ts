import { requireAuth } from "$lib/server/auth";
import { userDomain } from "@nojv/domain";

import type { PageServerLoad } from "./$types";

const { getUserDashboard } = userDomain;

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);

  const { stats, recentSubmissions, recommendations } = await getUserDashboard(actor.userId);

  return {
    stats,
    recentSubmissions,
    recommendations,
    username: actor.username
  };
};
