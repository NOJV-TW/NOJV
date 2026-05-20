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

  // `stats.totalAttempts` decides whether to render the WelcomeGuide or the
  // dashboard body, so the view must resolve before the page renders. The
  // heatmap/streak/trend feed (365 days of submissions) and the suggested-
  // problems recommender are heavier and only used inside the activity
  // branch — defer them as streamed promises so the shell paints first.
  const { stats, recentSubmissions, analytics } = await getDashboardView(actor.userId);

  // Brand-new accounts render `<WelcomeGuide />` instead of the chart blocks,
  // so don't kick off the heavy queries server-side at all.
  const hasActivity = stats.totalAttempts > 0;
  const streamed = hasActivity
    ? {
        activity: getSubmissionActivity(actor.userId, since).then((events) =>
          events.map((e) => ({ at: e.createdAt.toISOString(), ac: e.isAc })),
        ),
        suggestedProblems: getSuggestedProblems(actor.userId),
      }
    : {
        activity: Promise.resolve([] as { at: string; ac: boolean }[]),
        suggestedProblems: Promise.resolve(
          [] as Awaited<ReturnType<typeof getSuggestedProblems>>,
        ),
      };

  return {
    stats,
    recentSubmissions,
    username: actor.username,
    analytics,
    streamed,
  };
};
