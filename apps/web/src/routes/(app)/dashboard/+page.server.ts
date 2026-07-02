import { requireAuth } from "$lib/server/auth";
import { userDomain } from "@nojv/application";

import type { PageServerLoad } from "./$types";

const { getDashboardView, getSubmissionActivity } = userDomain;

const ACTIVITY_WINDOW_DAYS = 365;

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);

  const since = new Date(Date.now() - (ACTIVITY_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);

  const { stats, recentSubmissions, analytics } = await getDashboardView(actor.userId);

  const hasActivity = stats.totalAttempts > 0;
  const streamed = hasActivity
    ? {
        activity: getSubmissionActivity(actor.userId, since).then((events) =>
          events.map((e) => ({ at: e.createdAt.toISOString(), ac: e.isAc })),
        ),
      }
    : {
        activity: Promise.resolve([] as { at: string; ac: boolean }[]),
      };

  return {
    stats,
    recentSubmissions,
    username: actor.username,
    displayName: actor.displayName,
    platformRole: actor.platformRole,
    analytics,
    streamed,
  };
};
