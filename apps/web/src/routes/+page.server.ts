import type { PageServerLoad } from "./$types";

import { courseDomain } from "@nojv/domain";
import { DEFAULT_LOCALE } from "@nojv/core";
import { getActorContext } from "$lib/server/auth";

const { listAnnouncements, listUpcomingAssessments } = courseDomain;
import { deriveAssessmentWindowState, windowStateColorClass } from "$lib/types";

interface AnnouncementTranslationRow {
  locale: string;
  title: string;
  content: string;
}

/** Project translations into a flat title/content/published shape. */
function flattenAnnouncement(announcement: {
  id: string;
  status: "draft" | "published" | "archived";
  pinned: boolean;
  createdAt: Date;
  translations: AnnouncementTranslationRow[];
}) {
  const translations = announcement.translations;
  const localized = translations.find((t) => t.locale === DEFAULT_LOCALE) ??
    translations[0] ?? { title: "", content: "" };
  return {
    id: announcement.id,
    pinned: announcement.pinned,
    published: announcement.status === "published",
    createdAt: announcement.createdAt,
    title: localized.title,
    content: localized.content,
  };
}

export const load: PageServerLoad = async (event) => {
  const user = event.locals.user;
  const actor = getActorContext(event);

  if (!user) {
    const announcements = await listAnnouncements(actor);
    return {
      announcements: announcements.map(flattenAnnouncement),
      assessments: [],
    };
  }

  const now = new Date().toISOString();
  const [announcements, rawAssessments] = await Promise.all([
    listAnnouncements(actor),
    listUpcomingAssessments(user.id),
  ]);

  const assessments = rawAssessments.map((a) => {
    const windowState = deriveAssessmentWindowState({
      closesAt: a.closesAt,
      dueAt: a.dueAt,
      now,
      opensAt: a.opensAt,
    });
    return {
      ...a,
      // Template calls `new Date(dueAt)` directly; coalesce to closesAt.
      dueAt: a.dueAt ?? a.closesAt,
      windowState,
      windowStateColor: windowStateColorClass(windowState),
    };
  });

  return {
    announcements: announcements.map(flattenAnnouncement),
    assessments,
  };
};
