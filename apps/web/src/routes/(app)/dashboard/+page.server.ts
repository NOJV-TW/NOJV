import { requireAuth } from "$lib/server/auth";
import { platformDomain, userDomain } from "@nojv/application";

import type { PageServerLoad } from "./$types";

const { getDashboardView, getSubmissionActivity } = userDomain;
const { getPlatformOverview } = platformDomain;

const ACTIVITY_WINDOW_DAYS = 365;

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);

  const view = event.url.searchParams.get("view") === "server" ? "server" : "personal";

  const since = new Date(Date.now() - (ACTIVITY_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);

  const [{ stats, recentSubmissions, analytics }, platform] = await Promise.all([
    getDashboardView(actor.userId),
    view === "server" ? getPlatformOverview() : Promise.resolve(null),
  ]);

  const hasActivity = stats.totalAttempts > 0;
  let activity: Promise<{ at: string; ac: boolean }[]> = Promise.resolve([]);
  if (hasActivity) {
    activity = getSubmissionActivity(actor.userId, since).then((events) =>
      events.map((e) => ({ at: e.createdAt.toISOString(), ac: e.isAc })),
    );
    if (view === "server") {
      activity = activity.catch(() => []);
    }
  }
  const streamed = { activity };

  return {
    view,
    platform,
    stats,
    recentSubmissions,
    username: actor.username,
    displayName: actor.displayName,
    platformRole: actor.platformRole,
    analytics,
    streamed,
  };
};
