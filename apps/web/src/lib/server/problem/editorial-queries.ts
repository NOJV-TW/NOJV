import { prisma } from "@nojv/db";
import type { Language } from "@nojv/core";

export async function listEditorials(problemId: string) {
  return prisma.editorial.findMany({
    where: { problemId },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { username: true, name: true } } }
  });
}

export async function hasUserAcProblem(userId: string, problemId: string): Promise<boolean> {
  const count = await prisma.submission.count({
    where: { userId, problemId, status: "accepted", sampleOnly: false }
  });
  return count > 0;
}

export async function upsertEditorial(
  userId: string,
  problemId: string,
  content: string,
  language: Language
) {
  return prisma.editorial.upsert({
    where: { userId_problemId: { userId, problemId } },
    create: { userId, problemId, content, language },
    update: { content, language }
  });
}
