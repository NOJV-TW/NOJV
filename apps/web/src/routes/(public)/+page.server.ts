import type { PageServerLoad } from "./$types";

import { courseDomain, listUpcomingAssessments } from "@nojv/application";
import { DEFAULT_LOCALE } from "@nojv/core";
import { getActorContext } from "$lib/server/auth";

const { listAnnouncements } = courseDomain;
import { deriveAssignmentWindowState, windowStateColorClass } from "$lib/utils/coursework-path";

interface AnnouncementTranslationRow {
  locale: string;
  title: string;
  content: string;
}

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
      assessments: [],
    };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const [announcements, rawAssessments] = await Promise.all([
    listAnnouncements(actor),
    listUpcomingAssessments(user.id, now),
  ]);

  const assessments = rawAssessments.map((a) => {
    const windowState = deriveAssignmentWindowState({
      closesAt: a.closesAt,
      dueAt: a.dueAt,
      now: nowIso,
      opensAt: a.opensAt,
    });
    return {
      ...a,
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
