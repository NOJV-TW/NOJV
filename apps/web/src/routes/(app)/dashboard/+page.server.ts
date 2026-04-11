import { requireAuth } from "$lib/server/auth";
import { userDomain } from "@nojv/domain";
import { userDailyActivityRepo } from "@nojv/db";

import type { PageServerLoad } from "./$types";

const { getUserDashboard, getUserAnalytics } = userDomain;

const ACTIVITY_DAYS = 30;

/** Midnight UTC for the day `n` days before now (inclusive lower bound). */
function utcDayOffset(daysBack: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack)
  );
}

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);

  const from = utcDayOffset(ACTIVITY_DAYS - 1);
  const to = utcDayOffset(0);

  const [
    { stats, recentSubmissions },
    dailyActivity,
    analytics
  ] = await Promise.all([
    getUserDashboard(actor.userId),
    userDailyActivityRepo.findRange(actor.userId, from, to),
    getUserAnalytics(actor.userId)
  ]);

  return {
    stats,
    recentSubmissions,
    username: actor.username,
    analytics,
    dailyActivity: dailyActivity
      .slice()
      .reverse()
      .map((row) => ({
        date: row.date.toISOString().slice(0, 10),
        acCount: row.acCount,
        submissionCount: row.submissionCount
      }))
  };
};
