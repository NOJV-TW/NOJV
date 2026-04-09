import {
  dailyActivityArraySchema,
  difficultyDistSchema,
  languageDistSchema,
  type DailyActivity,
  type DifficultyDist,
  type LanguageDist
} from "@nojv/core";
import {
  problemRepo,
  runTransaction,
  submissionRepo,
  userStatsRepo,
  type Prisma
} from "@nojv/db";

/** Parse a JSON-column value with a Zod schema, returning `fallback` on failure. */
function parseOr<T>(
  schema: { safeParse: (v: unknown) => { data?: T } },
  value: unknown,
  fallback: T
): T {
  return schema.safeParse(value).data ?? fallback;
}

/**
 * Cast a plain JSON-compatible value to `Prisma.InputJsonValue`. Prisma's
 * recursive `InputJsonValue` type doesn't unify cleanly with Zod-inferred
 * strict types, but structurally our data is always valid JSON.
 */
function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

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
    const acCount = await submissionRepo.count({
      userId: submission.userId,
      problemId: submission.problemId,
      status: "accepted",
      sampleOnly: false
    });
    isFirstAc = acCount === 1;
  }

  let difficulty: string | null = null;
  if (isFirstAc) {
    const problem = await problemRepo.findDifficultyById(submission.problemId);
    difficulty = problem?.difficulty ?? null;
  }

  const today = new Date().toISOString().slice(0, 10);

  await runTransaction(async (tx) => {
    const existing = await userStatsRepo.withTx(tx).findByUserId(submission.userId);

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

      await userStatsRepo.withTx(tx).create({
        userId: submission.userId,
        totalAc: isFirstAc ? 1 : 0,
        totalAttempts: 1,
        languageDist: langDist,
        difficultyDist: diffDist,
        dailyActivity: asJson(daily),
        lastSubmittedAt: new Date()
      });
    } else {
      const langDist = parseOr<LanguageDist>(languageDistSchema, existing.languageDist, {});
      langDist[submission.language] = (langDist[submission.language] ?? 0) + 1;

      const diffDist = parseOr<DifficultyDist>(
        difficultyDistSchema,
        existing.difficultyDist,
        {}
      );
      if (isFirstAc && difficulty) {
        diffDist[difficulty] = (diffDist[difficulty] ?? 0) + 1;
      }

      const daily = parseOr<DailyActivity[]>(
        dailyActivityArraySchema,
        existing.dailyActivity,
        []
      );
      if (isAc) {
        const todayEntry = daily.find((d) => d.date === today);
        if (todayEntry) {
          todayEntry.acCount += 1;
        } else {
          daily.push({ date: today, acCount: 1 });
        }
        if (daily.length > 90) daily.shift();
      }

      await userStatsRepo.withTx(tx).update(submission.userId, {
        ...(isFirstAc ? { totalAc: { increment: 1 } } : {}),
        totalAttempts: { increment: 1 },
        languageDist: langDist,
        difficultyDist: diffDist,
        dailyActivity: asJson(daily),
        lastSubmittedAt: new Date()
      });
    }
  });
}
