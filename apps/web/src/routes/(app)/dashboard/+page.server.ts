import { requireAuth } from "$lib/server/auth";
import { userDomain } from "@nojv/domain";

import type { PageServerLoad } from "./$types";

const { getDashboardView, getSubmissionActivity, getSuggestedProblems } = userDomain;

const ACTIVITY_WINDOW_DAYS = 365;

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);

  // Generous lower bound — the client buckets these into local days and
  // renders exactly the last ACTIVITY_WINDOW_DAYS of them.
  const since = new Date(Date.now() - (ACTIVITY_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);

  const [{ stats, recentSubmissions, analytics }, activity, suggestedProblems] =
    await Promise.all([
      getDashboardView(actor.userId),
      getSubmissionActivity(actor.userId, since),
      getSuggestedProblems(actor.userId),
    ]);

  return {
    stats,
    recentSubmissions,
    username: actor.username,
    analytics,
    activity: activity.map((e) => ({ at: e.createdAt.toISOString(), ac: e.isAc })),
    suggestedProblems,
  };
};
