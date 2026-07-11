import { prisma } from "../client";

export const postVoteRepo = {
  async setVote(postId: string, userId: string, value: number) {
    if (value === 0) {
      await prisma.postVote.deleteMany({ where: { postId, userId } });
      return;
    }
    await prisma.postVote.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId, value },
      update: { value },
    });
  },

  async aggregate(postId: string, viewerId: string) {
    const [sum, viewer] = await Promise.all([
      prisma.postVote.aggregate({ _sum: { value: true }, where: { postId } }),
      prisma.postVote.findUnique({
        where: { postId_userId: { postId, userId: viewerId } },
        select: { value: true },
      }),
    ]);
    return { score: sum._sum.value ?? 0, viewerVote: viewer?.value ?? 0 };
  },
};
