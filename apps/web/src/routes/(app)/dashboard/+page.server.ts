import { requireAuth } from "$lib/server/auth";
import { userDomain } from "@nojv/domain";

import type { PageServerLoad } from "./$types";

const { getDashboardView, getDailyActivity, getStreakDays, getSuggestedProblems } = userDomain;

const ACTIVITY_DAYS = 30;
const TREND_DAYS = 7;

function utcDayOffset(daysBack: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack),
  );
}

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);

  const from = utcDayOffset(ACTIVITY_DAYS - 1);
  const to = utcDayOffset(0);

  const [
    { stats, recentSubmissions, analytics },
    dailyActivity,
    streakDays,
    suggestedProblems,
  ] = await Promise.all([
    getDashboardView(actor.userId),
    getDailyActivity(actor.userId, from, to),
    getStreakDays(actor.userId),
    getSuggestedProblems(actor.userId),
  ]);

  const activityByDate = new Map(
    dailyActivity.map((row) => [row.date.toISOString().slice(0, 10), row]),
  );

  const filledActivity = Array.from({ length: ACTIVITY_DAYS }, (_, i) => {
    const dayOffset = ACTIVITY_DAYS - 1 - i;
    const d = utcDayOffset(dayOffset);
    const date = d.toISOString().slice(0, 10);
    const row = activityByDate.get(date);
    return {
      date,
      acCount: row?.acCount ?? 0,
      submissionCount: row?.submissionCount ?? 0,
    };
  });

  // Last 7 days subset — same UTC-day rows the activity grid already
  // computed, so we don't need to re-query.
  const weeklyTrend = filledActivity.slice(ACTIVITY_DAYS - TREND_DAYS);

  return {
    stats,
    recentSubmissions,
    username: actor.username,
    analytics,
    dailyActivity: filledActivity,
    streakDays,
    weeklyTrend,
    suggestedProblems,
  };
};
