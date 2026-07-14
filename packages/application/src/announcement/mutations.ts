import {
  announcementRepo,
  announcementTranslationRepo,
  courseMembershipRepo,
  runTransaction,
  userRepo,
  type TransactionClient,
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
  tx: TransactionClient,
  announcementId: string,
  title: string,
  courseId: string | null,
  publishedAt: Date,
) {
  const recipientIds = courseId
    ? await courseMembershipRepo.withTx(tx).listActiveMemberUserIds(courseId)
    : (await userRepo.withTx(tx).listActiveIds()).map((u) => u.id);
  if (recipientIds.length === 0) return;
  await notificationDomain.createNotificationBatchInTransaction(
    tx,
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
      dedupeKey: `announcement_published:${announcementId}:${publishedAt.toISOString()}:${userId}`,
    })),
  );
}

export async function createAnnouncement(data: AnnouncementCreateInput) {
  const parsed = announcementCreateSchema.parse(data);
  return runTransaction(async (tx) => {
    const publishedAt = parsed.published ? new Date() : null;
    const announcement = await announcementRepo.withTx(tx).create({
      pinned: parsed.pinned,
      status: parsed.published ? "published" : "draft",
      publishedAt,
      audience: parsed.audience,
      expiresAt: parsed.expiresAt ?? null,
      ...(parsed.courseId ? { course: { connect: { id: parsed.courseId } } } : {}),
      ...(parsed.createdByUserId
        ? { createdBy: { connect: { id: parsed.createdByUserId } } }
        : {}),
    });
    await announcementTranslationRepo.withTx(tx).upsert(announcement.id, DEFAULT_LOCALE, {
      title: parsed.title,
      content: parsed.content,
    });
    if (publishedAt) {
      await fanoutAnnouncementPublished(
        tx,
        announcement.id,
        parsed.title,
        parsed.courseId ?? null,
        publishedAt,
      );
    }
    return announcement;
  });
}

export async function updateAnnouncement(id: string, data: AnnouncementUpdateInput) {
  const parsed = announcementUpdateSchema.parse(data);
  return runTransaction(async (tx) => {
    const prior = await announcementRepo.withTx(tx).findById(id);
    const publishedAt = parsed.published ? (prior?.publishedAt ?? new Date()) : null;
    const updated = await announcementRepo.withTx(tx).update(id, {
      pinned: parsed.pinned,
      status: parsed.published ? "published" : "draft",
      publishedAt,
      audience: parsed.audience,
      expiresAt: parsed.expiresAt ?? null,
    });
    await announcementTranslationRepo.withTx(tx).upsert(id, DEFAULT_LOCALE, {
      title: parsed.title,
      content: parsed.content,
    });
    if (publishedAt && prior?.status !== "published") {
      await fanoutAnnouncementPublished(
        tx,
        id,
        parsed.title,
        prior?.courseId ?? null,
        publishedAt,
      );
    }
    return updated;
  });
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
  return runTransaction(async (tx) => {
    const announcement = await announcementRepo.withTx(tx).findById(id);
    if (!announcement) return null;
    const next = announcement.status === "published" ? "draft" : "published";
    const publishedAt = next === "published" ? new Date() : null;
    const updated = await announcementRepo.withTx(tx).update(id, {
      status: next,
      publishedAt,
    });
    if (publishedAt) {
      const translation = announcement.translations.find((t) => t.locale === DEFAULT_LOCALE);
      await fanoutAnnouncementPublished(
        tx,
        id,
        translation?.title ?? id,
        announcement.courseId,
        publishedAt,
      );
    }
    return updated;
  });
}
