import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";

export const announcementRepo = {
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

  /**
   * Recent published announcements with the author preview needed by
   * the course overview announcement row (avatar + name + timestamp).
   * The Announcement model is currently global (no courseId column), so
   * this method returns the most recent global announcements — the
   * `courseId` parameter on the domain helper is forward-compatible for
   * when per-course announcements land.
   */
  listRecentWithAuthor(take: number) {
    const now = new Date();
    return prisma.announcement.findMany({
      where: {
        status: "published",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
      },
      orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
      include: {
        translations: true,
        createdBy: { select: { id: true, name: true } }
      },
      take
    });
  },

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
