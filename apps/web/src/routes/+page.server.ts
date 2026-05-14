import type { PageServerLoad } from "./$types";

import { courseDomain } from "@nojv/domain";
import { DEFAULT_LOCALE } from "@nojv/core";
import { getActorContext } from "$lib/server/auth";

const { listAnnouncements, listUpcomingAssignments } = courseDomain;
import { deriveAssignmentWindowState, windowStateColorClass } from "$lib/utils/coursework-path";

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
  expiresAt: Date | null;
  translations: AnnouncementTranslationRow[];
  createdBy: { id: string; name: string } | null;
}) {
  const translations = announcement.translations;
  const localized = translations.find((t) => t.locale === DEFAULT_LOCALE) ??
    translations[0] ?? { title: "", content: "" };
  return {
    id: announcement.id,
    pinned: announcement.pinned,
    published: announcement.status === "published",
    createdAt: announcement.createdAt.toISOString(),
    expiresAt: announcement.expiresAt?.toISOString() ?? null,
    title: localized.title,
    content: localized.content,
    authorName: announcement.createdBy?.name ?? "NOJV",
  };
}

export const load: PageServerLoad = async (event) => {
  const user = event.locals.user;
  const actor = getActorContext(event);

  if (!user) {
    const announcements = await listAnnouncements(actor);
    return {
      announcements: announcements.map(flattenAnnouncement),
      assignments: [],
    };
  }

  const now = new Date().toISOString();
  const [announcements, rawAssignments] = await Promise.all([
    listAnnouncements(actor),
    listUpcomingAssignments(user.id),
  ]);

  const assignments = rawAssignments.map((a) => {
    const windowState = deriveAssignmentWindowState({
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
    assignments,
  };
};
