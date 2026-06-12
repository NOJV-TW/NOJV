import { prisma } from "../client";

export const editorialVoteRepo = {
  async setVote(editorialId: string, userId: string, value: number) {
    if (value === 0) {
      await prisma.editorialVote.deleteMany({ where: { editorialId, userId } });
      return;
    }
    await prisma.editorialVote.upsert({
      where: { editorialId_userId: { editorialId, userId } },
      create: { editorialId, userId, value },
      update: { value },
    });
  },

  async aggregate(editorialId: string, viewerId: string) {
    const [sum, viewer] = await Promise.all([
      prisma.editorialVote.aggregate({ _sum: { value: true }, where: { editorialId } }),
      prisma.editorialVote.findUnique({
        where: { editorialId_userId: { editorialId, userId: viewerId } },
        select: { value: true },
      }),
    ]);
    return { score: sum._sum.value ?? 0, viewerVote: viewer?.value ?? 0 };
  },
};
