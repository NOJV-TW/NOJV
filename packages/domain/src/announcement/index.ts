import { announcementRepo, announcementTranslationRepo } from "@nojv/db";
import { DEFAULT_LOCALE } from "@nojv/core";

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

  return announcement;
}

/**
 * Update an announcement plus its default-locale translation.
 */
export async function updateAnnouncement(id: string, data: AnnouncementUpdatePayload) {
  const updated = await announcementRepo.update(id, {
    pinned: data.pinned,
    status: data.published ? "published" : "draft",
    publishedAt: data.published ? new Date() : null
  });

  await announcementTranslationRepo.upsert(id, DEFAULT_LOCALE, {
    title: data.title,
    content: data.content
  });

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
  return announcementRepo.update(id, {
    status: next,
    publishedAt: next === "published" ? new Date() : null
  });
}
