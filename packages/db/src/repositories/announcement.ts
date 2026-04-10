import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";

export const announcementRepo = {
  /** List published, unexpired announcements (pinned first, then newest).
   *
   * Status and expiry are enforced here — the previous implementation
   * returned drafts because it only sorted, never filtered. */
  listPublished(take: number) {
    const now = new Date();
    return prisma.announcement.findMany({
      where: {
        status: "published",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
      },
      orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
      include: { translations: true },
      take
    });
  },

  /** List all announcements for admin management. */
  listAll() {
    return prisma.announcement.findMany({
      orderBy: { createdAt: "desc" },
      include: { translations: true }
    });
  },

  findById(id: string) {
    return prisma.announcement.findUnique({
      where: { id },
      include: { translations: true }
    });
  },

  findPinnedStatus(id: string) {
    return prisma.announcement.findUnique({
      where: { id },
      select: { pinned: true }
    });
  },

  findStatus(id: string) {
    return prisma.announcement.findUnique({
      where: { id },
      select: { status: true }
    });
  },

  create(data: Prisma.AnnouncementCreateInput) {
    return prisma.announcement.create({ data });
  },

  update(id: string, data: Prisma.AnnouncementUpdateInput) {
    return prisma.announcement.update({
      where: { id },
      data
    });
  },

  delete(id: string) {
    return prisma.announcement.delete({ where: { id } });
  }
};
