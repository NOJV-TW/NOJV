import { announcementRepo, announcementTranslationRepo, userRepo } from "@nojv/db";
import { DEFAULT_LOCALE } from "@nojv/core";

import * as notificationDomain from "../notification";

export function listAllAnnouncements() {
  return announcementRepo.listAll();
}

export interface AnnouncementCreatePayload {
  title: string;
  content: string;
  pinned: boolean;
  published: boolean;
}

export interface AnnouncementUpdatePayload {
  title: string;
  content: string;
  pinned: boolean;
  published: boolean;
}

// Fan out `announcement_published` to every active user. `title` is the
// default-locale (zh-TW) translation — renderer can fall back to whatever
// locale is available. Kept intentionally small: one row per (user,
// announcement), params carry just enough to render the bell entry.
async function fanoutAnnouncementPublished(announcementId: string, title: string) {
  const users = await userRepo.listActiveIds();
  if (users.length === 0) return;
  await notificationDomain.createNotificationBatch(
    users.map((u) => ({
      userId: u.id,
      type: "announcement_published" as const,
      params: { announcementId, titleEn: title, titleZhTw: title },
      linkUrl: null
    }))
  );
}

// Two writes intentionally not wrapped in a transaction — admin authoring is
// low-volume and the translation upsert is retry-safe.
export async function createAnnouncement(data: AnnouncementCreatePayload) {
  const announcement = await announcementRepo.create({
    pinned: data.pinned,
    status: data.published ? "published" : "draft",
    publishedAt: data.published ? new Date() : null
  });

  await announcementTranslationRepo.upsert(announcement.id, DEFAULT_LOCALE, {
    title: data.title,
    content: data.content
  });

  if (data.published) {
    await fanoutAnnouncementPublished(announcement.id, data.title);
  }

  return announcement;
}

/**
 * Update an announcement plus its default-locale translation.
 */
export async function updateAnnouncement(id: string, data: AnnouncementUpdatePayload) {
  // Snapshot prior status so we can detect the draft → published transition
  // and fan out once per publish, not on every edit of an already-live row.
  const prior = await announcementRepo.findStatus(id);

  const updated = await announcementRepo.update(id, {
    pinned: data.pinned,
    status: data.published ? "published" : "draft",
    publishedAt: data.published ? new Date() : null
  });

  await announcementTranslationRepo.upsert(id, DEFAULT_LOCALE, {
    title: data.title,
    content: data.content
  });

  if (data.published && prior?.status !== "published") {
    await fanoutAnnouncementPublished(id, data.title);
  }

  return updated;
}

export async function deleteAnnouncement(id: string) {
  return announcementRepo.delete(id);
}

export async function toggleAnnouncementPin(id: string) {
  const announcement = await announcementRepo.findPinnedStatus(id);
  if (!announcement) return null;
  return announcementRepo.update(id, { pinned: !announcement.pinned });
}

export async function toggleAnnouncementPublish(id: string) {
  const announcement = await announcementRepo.findStatus(id);
  if (!announcement) return null;
  const next = announcement.status === "published" ? "draft" : "published";
  const updated = await announcementRepo.update(id, {
    status: next,
    publishedAt: next === "published" ? new Date() : null
  });

  if (next === "published") {
    // Read the default-locale translation for the notification payload.
    // Absence falls back to the announcement id — UI can cope, and the
    // admin UI always upserts a translation on create.
    const full = await announcementRepo.findById(id);
    const translation = full?.translations.find((t) => t.locale === DEFAULT_LOCALE);
    await fanoutAnnouncementPublished(id, translation?.title ?? id);
  }

  return updated;
}
