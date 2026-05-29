import { prisma } from "../client";

export const problemBookmarkRepo = {
  isBookmarked(userId: string, problemId: string) {
    return prisma.problemBookmark.findUnique({
      where: { userId_problemId: { userId, problemId } },
    });
  },

  add(userId: string, problemId: string) {
    return prisma.problemBookmark.upsert({
      where: { userId_problemId: { userId, problemId } },
      create: { userId, problemId },
      update: {},
    });
  },

  remove(userId: string, problemId: string) {
    return prisma.problemBookmark.deleteMany({ where: { userId, problemId } });
  },

  async listBookmarkedIds(userId: string, problemIds: string[]): Promise<Set<string>> {
    if (problemIds.length === 0) return new Set();
    const rows = await prisma.problemBookmark.findMany({
      where: { userId, problemId: { in: problemIds } },
      select: { problemId: true },
    });
    return new Set(rows.map((r) => r.problemId));
  },
};
