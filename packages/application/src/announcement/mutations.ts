import {
  announcementRepo,
  announcementTranslationRepo,
  courseMembershipRepo,
  userRepo,
} from "@nojv/db";
import { DEFAULT_LOCALE, announcementAudienceSchema } from "@nojv/core";
import { z } from "zod";

import * as notificationDomain from "../notification";

export const announcementCreateSchema = z.object({
  title: z.string().trim().min(1),
  content: z.string().trim().min(1),
  pinned: z.boolean().default(false),
  published: z.boolean().default(false),
  audience: announcementAudienceSchema.default("all"),
  expiresAt: z.coerce.date().nullable().optional(),
  courseId: z.string().min(1).nullable().optional(),
  createdByUserId: z.string().min(1).nullable().optional(),
});

export const announcementUpdateSchema = announcementCreateSchema;

export type AnnouncementCreateInput = z.input<typeof announcementCreateSchema>;
export type AnnouncementUpdateInput = z.input<typeof announcementUpdateSchema>;

async function fanoutAnnouncementPublished(
  announcementId: string,
  title: string,
  courseId: string | null,
) {
  const recipientIds = courseId
    ? await courseMembershipRepo.listActiveMemberUserIds(courseId)
    : (await userRepo.listActiveIds()).map((u) => u.id);
  if (recipientIds.length === 0) return;
  await notificationDomain.createNotificationBatch(
    recipientIds.map((userId) => ({
      userId,
      type: "announcement_published" as const,
      params: {
        announcementId,
        titleEn: title,
        titleZhTw: title,
        ...(courseId ? { courseId } : {}),
      },
      linkUrl: null,
    })),
  );
}

export async function createAnnouncement(data: AnnouncementCreateInput) {
  const parsed = announcementCreateSchema.parse(data);
  const announcement = await announcementRepo.create({
    pinned: parsed.pinned,
    status: parsed.published ? "published" : "draft",
    publishedAt: parsed.published ? new Date() : null,
    audience: parsed.audience,
    expiresAt: parsed.expiresAt ?? null,
    ...(parsed.courseId ? { course: { connect: { id: parsed.courseId } } } : {}),
    ...(parsed.createdByUserId
      ? { createdBy: { connect: { id: parsed.createdByUserId } } }
      : {}),
  });

  await announcementTranslationRepo.upsert(announcement.id, DEFAULT_LOCALE, {
    title: parsed.title,
    content: parsed.content,
  });

  if (parsed.published) {
    await fanoutAnnouncementPublished(announcement.id, parsed.title, parsed.courseId ?? null);
  }

  return announcement;
}

export async function updateAnnouncement(id: string, data: AnnouncementUpdateInput) {
  const parsed = announcementUpdateSchema.parse(data);
  const prior = await announcementRepo.findById(id);

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
    await fanoutAnnouncementPublished(id, parsed.title, prior?.courseId ?? null);
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
    const full = await announcementRepo.findById(id);
    const translation = full?.translations.find((t) => t.locale === DEFAULT_LOCALE);
    await fanoutAnnouncementPublished(id, translation?.title ?? id, full?.courseId ?? null);
  }

  return updated;
}
