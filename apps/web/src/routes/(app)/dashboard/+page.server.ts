import { requireAuth } from "$lib/server/auth";
import { DEFAULT_LOCALE } from "@nojv/core";
import { courseDomain, userDomain } from "@nojv/domain";
import { userDailyActivityRepo } from "@nojv/db";
import { deriveAssessmentWindowState, windowStateColorClass } from "$lib/types";

import type { PageServerLoad } from "./$types";

const { getUserDashboard, getUserAnalytics } = userDomain;
const { listCourseCards, listUpcomingAssessments, listAnnouncements } = courseDomain;

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

  // Daily activity is now first-class in `UserDailyActivity` (one row
  // per user per UTC day) instead of a JSON blob on `UserStats`.
  const from = utcDayOffset(ACTIVITY_DAYS - 1);
  const to = utcDayOffset(0);

  const [
    { stats, recentSubmissions, recommendations },
    dailyActivity,
    analytics,
    courses,
    upcomingAssessments,
    announcements
  ] = await Promise.all([
    getUserDashboard(actor.userId),
    userDailyActivityRepo.findRange(actor.userId, from, to),
    getUserAnalytics(actor.userId),
    listCourseCards(actor.userId),
    listUpcomingAssessments(actor.userId),
    listAnnouncements()
  ]);

  const now = new Date().toISOString();
  const mappedAssessments = upcomingAssessments.map((a) => {
    const windowState = deriveAssessmentWindowState({
      closesAt: a.closesAt,
      dueAt: a.dueAt,
      now,
      opensAt: a.opensAt
    });
    return {
      courseSlug: a.courseSlug,
      courseTitle: a.courseTitle,
      slug: a.slug,
      title: a.title,
      closesAt: a.closesAt,
      dueAt: a.dueAt ?? a.closesAt,
      opensAt: a.opensAt,
      windowState,
      windowStateColor: windowStateColorClass(windowState)
    };
  });

  const mappedAnnouncements = announcements.map((a) => {
    const localized =
      a.translations.find((t) => t.locale === DEFAULT_LOCALE) ??
      a.translations[0] ?? { title: "", content: "" };
    return {
      id: a.id,
      pinned: a.pinned,
      createdAt: a.createdAt.toISOString(),
      title: localized.title,
      content: localized.content
    };
  });

  return {
    stats,
    recentSubmissions,
    recommendations,
    username: actor.username,
    analytics,
    courses,
    upcomingAssessments: mappedAssessments,
    announcements: mappedAnnouncements,
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
