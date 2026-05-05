import { announcementRepo, announcementTranslationRepo, userRepo } from "@nojv/db";
import { DEFAULT_LOCALE, announcementAudienceSchema } from "@nojv/core";
import type { AnnouncementAudience } from "@nojv/core";
import { z } from "zod";

import * as notificationDomain from "../notification";
import type { PlatformRole } from "@nojv/core";

export function listAllAnnouncements() {
  return announcementRepo.listAll();
}

interface ActorRoleHint {
  platformRole: PlatformRole;
}

/**
 * Resolve which audiences the given actor is allowed to see in public lists.
 * Anonymous viewers are treated as students. Admin routes call
 * `listAllAnnouncements` directly and bypass this filter.
 */
function audiencesVisibleTo(actor: ActorRoleHint | null | undefined): AnnouncementAudience[] {
  if (actor?.platformRole === "teacher" || actor?.platformRole === "admin") {
    return ["all", "students", "teachers"];
  }
  return ["all", "students"];
}

export function listPublicAnnouncements(actor: ActorRoleHint | null | undefined, take = 20) {
  return announcementRepo.listPublished(take, audiencesVisibleTo(actor));
}

export function listPublicAnnouncementsForCourse(
  courseId: string,
  actor: ActorRoleHint | null | undefined,
  take: number,
) {
  return announcementRepo.listRecentForCourse(courseId, take, audiencesVisibleTo(actor));
}

export const announcementCreateSchema = z.object({
  title: z.string().trim().min(1),
  content: z.string().trim().min(1),
  pinned: z.boolean().default(false),
  published: z.boolean().default(false),
  audience: announcementAudienceSchema.default("all"),
  expiresAt: z.coerce.date().nullable().optional(),
});

export const announcementUpdateSchema = announcementCreateSchema;

export type AnnouncementCreatePayload = z.input<typeof announcementCreateSchema>;
export type AnnouncementUpdatePayload = z.input<typeof announcementUpdateSchema>;

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
      linkUrl: null,
    })),
  );
}

// Two writes intentionally not wrapped in a transaction — admin authoring is
// low-volume and the translation upsert is retry-safe.
export async function createAnnouncement(data: AnnouncementCreatePayload) {
  const parsed = announcementCreateSchema.parse(data);
  const announcement = await announcementRepo.create({
    pinned: parsed.pinned,
    status: parsed.published ? "published" : "draft",
    publishedAt: parsed.published ? new Date() : null,
    audience: parsed.audience,
    expiresAt: parsed.expiresAt ?? null,
  });

  await announcementTranslationRepo.upsert(announcement.id, DEFAULT_LOCALE, {
    title: parsed.title,
    content: parsed.content,
  });

  if (parsed.published) {
    await fanoutAnnouncementPublished(announcement.id, parsed.title);
  }

  return announcement;
}

/**
 * Update an announcement plus its default-locale translation.
 */
export async function updateAnnouncement(id: string, data: AnnouncementUpdatePayload) {
  const parsed = announcementUpdateSchema.parse(data);
  // Snapshot prior status so we can detect the draft → published transition
  // and fan out once per publish, not on every edit of an already-live row.
  const prior = await announcementRepo.findStatus(id);

  const updated = await announcementRepo.update(id, {
    pinned: parsed.pinned,
    status: parsed.published ? "published" : "draft",
    publishedAt: parsed.published ? new Date() : null,
    audience: parsed.audience,
    expiresAt: parsed.expiresAt ?? null,
  });

  await announcementTranslationRepo.upsert(id, DEFAULT_LOCALE, {
    title: parsed.title,
    content: parsed.content,
  });

  if (parsed.published && prior?.status !== "published") {
    await fanoutAnnouncementPublished(id, parsed.title);
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
    publishedAt: next === "published" ? new Date() : null,
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
