import type { DailyActivity, DifficultyDist, LanguageDist } from "@nojv/core";
import { prisma, type Prisma } from "@nojv/db";

export async function updateUserStats(submission: {
  id: string;
  language: string;
  problemId: string;
  sampleOnly: boolean;
  status: string;
  userId: string;
}): Promise<void> {
  if (submission.sampleOnly) return;

  const isAc = submission.status === "accepted";

  let isFirstAc = false;
  if (isAc) {
    const acCount = await prisma.submission.count({
      where: {
        userId: submission.userId,
        problemId: submission.problemId,
        status: "accepted",
        sampleOnly: false
      }
    });
    isFirstAc = acCount === 1;
  }

  let difficulty: string | null = null;
  if (isFirstAc) {
    const problem = await prisma.problem.findUnique({
      select: { difficulty: true },
      where: { id: submission.problemId }
    });
    difficulty = problem?.difficulty ?? null;
  }

  const today = new Date().toISOString().slice(0, 10);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.userStats.findUnique({
      where: { userId: submission.userId }
    });

    if (!existing) {
      const langDist: LanguageDist = { [submission.language]: 1 };
      const diffDist: DifficultyDist = {};
      const daily: DailyActivity[] = [];

      if (isFirstAc && difficulty) {
        diffDist[difficulty] = 1;
      }
      if (isAc) {
        daily.push({ date: today, acCount: 1 });
      }

      await tx.userStats.create({
        data: {
          userId: submission.userId,
          totalAc: isFirstAc ? 1 : 0,
          totalAttempts: 1,
          languageDist: langDist,
          difficultyDist: diffDist,
          dailyActivity: daily as unknown as Prisma.InputJsonValue,
          lastSubmittedAt: new Date()
        }
      });
    } else {
      const langDist = (existing.languageDist ?? {}) as LanguageDist;
      langDist[submission.language] = (langDist[submission.language] ?? 0) + 1;

      const diffDist = (existing.difficultyDist ?? {}) as DifficultyDist;
      if (isFirstAc && difficulty) {
        diffDist[difficulty] = (diffDist[difficulty] ?? 0) + 1;
      }

      const daily = (existing.dailyActivity ?? []) as unknown as DailyActivity[];
      if (isAc) {
        const todayEntry = daily.find((d) => d.date === today);
        if (todayEntry) {
          todayEntry.acCount += 1;
        } else {
          daily.push({ date: today, acCount: 1 });
        }
        if (daily.length > 90) daily.shift();
      }

      await tx.userStats.update({
        data: {
          ...(isFirstAc ? { totalAc: { increment: 1 } } : {}),
          totalAttempts: { increment: 1 },
          languageDist: langDist,
          difficultyDist: diffDist,
          dailyActivity: daily as unknown as Prisma.InputJsonValue,
          lastSubmittedAt: new Date()
        },
        where: { userId: submission.userId }
      });
    }
  });
}
