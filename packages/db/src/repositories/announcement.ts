import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";

export const announcementRepo = {
  /** List published announcements (pinned first, then newest). */
  listPublished(take: number) {
    return prisma.announcement.findMany({
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take
    });
  },

  /** List all announcements for admin management. */
  listAll() {
    return prisma.announcement.findMany({
      orderBy: { createdAt: "desc" }
    });
  },

  findById(id: string) {
    return prisma.announcement.findUnique({ where: { id } });
  },

  findPinnedStatus(id: string) {
    return prisma.announcement.findUnique({
      where: { id },
      select: { pinned: true }
    });
  },

  findPublishedStatus(id: string) {
    return prisma.announcement.findUnique({
      where: { id },
      select: { published: true }
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
