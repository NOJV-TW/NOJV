import { prisma, type Prisma } from "@nojv/db";
import { userChannel, SSE_SUBMISSION_VERDICT } from "@nojv/core";
import { createPublisher, publishEvent } from "./redis";
import type {
  DailyActivity,
  DifficultyDist,
  JudgeType,
  LanguageDist,
  NetworkAccessConfig,
  PipelineConfig,
  ProblemJudgeTestcase,
  SubmissionResult,
  SubmissionType
} from "@nojv/core";

type SubmissionWithProblemSlug = Prisma.SubmissionGetPayload<{
  include: { problem: { select: { slug: true } } };
}>;

export async function markSubmissionRunning(submissionId: string) {
  return prisma.submission.update({
    data: { status: "running" },
    where: { id: submissionId }
  });
}

export async function completeSubmission(submissionId: string, result: SubmissionResult) {
  const submission: SubmissionWithProblemSlug = await prisma.submission.update({
    data: {
      compilerOutput: result.verdict === "compile_error" ? result.feedback : null,
      runtimeMs: result.runtimeMs,
      score: result.score,
      status: result.verdict,
      verdictDetail: result,
      ...(result.subtaskResults ? { subtaskResults: result.subtaskResults } : {}),
      ...(result.pipelineResult ? { pipelineResult: result.pipelineResult } : {}),
      ...(result.artifactPaths ? { artifactPaths: result.artifactPaths } : {})
    },
    include: { problem: { select: { slug: true } } },
    where: { id: submissionId }
  });

  // Update contest scores if this submission is part of a contest
  if (submission.contestParticipationId && !submission.sampleOnly) {
    await updateContestScoresAfterJudge(submission.contestParticipationId);
  }

  // Update user stats and publish SSE event in parallel
  await Promise.all([
    updateUserStats(submission),
    publishSubmissionVerdict(submission, submission.problem.slug)
  ]);

  return submission;
}

async function updateUserStats(submission: {
  id: string;
  language: string;
  problemId: string;
  sampleOnly: boolean;
  status: string;
  userId: string;
}): Promise<void> {
  if (submission.sampleOnly) return;

  const isAc = submission.status === "accepted";

  // Check if this is the user's first AC for this problem.
  // The current submission has already been updated, so count >= 1 means it includes itself.
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
    isFirstAc = acCount === 1; // only the current submission is AC
  }

  // Get problem difficulty for difficultyDist
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
        // Keep only last 90 days
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

import type Redis from "ioredis";

let publisher: Redis | null = null;
function getPublisher(): Redis {
  publisher ??= createPublisher(process.env.REDIS_URL ?? "redis://localhost:6379");
  return publisher;
}

async function publishSubmissionVerdict(
  submission: {
    id: string;
    problemId: string;
    score: number;
    status: string;
    userId: string;
  },
  problemSlug: string
): Promise<void> {
  try {
    await publishEvent(getPublisher(), userChannel(submission.userId), {
      type: SSE_SUBMISSION_VERDICT,
      submissionId: submission.id,
      verdict: submission.status,
      score: submission.score,
      problemId: submission.problemId,
      problemSlug: problemSlug
    });
  } catch {
    // Non-critical: don't fail the judge if publish fails
  }
}

async function updateContestScoresAfterJudge(contestParticipationId: string): Promise<void> {
  const participation = await prisma.contestParticipation.findUnique({
    include: {
      contest: {
        include: {
          problems: { orderBy: { ordinal: "asc" } }
        }
      }
    },
    where: { id: contestParticipationId }
  });

  if (!participation) return;

  const { contest } = participation;

  const allSubmissions = await prisma.submission.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      problemId: true,
      score: true,
      status: true
    },
    where: {
      contestParticipationId: participation.id,
      sampleOnly: false
    }
  });

  const contestProblems = new Map(contest.problems.map((p) => [p.problemId, p]));

  if (contest.scoringMode === "icpc") {
    let solvedCount = 0;
    let totalPenalty = 0;

    const byProblem = new Map<string, typeof allSubmissions>();
    for (const sub of allSubmissions) {
      if (!contestProblems.has(sub.problemId)) continue;
      const existing = byProblem.get(sub.problemId) ?? [];
      existing.push(sub);
      byProblem.set(sub.problemId, existing);
    }

    for (const [, problemSubs] of byProblem) {
      let wrongAttempts = 0;
      let solved = false;

      for (const sub of problemSubs) {
        if (sub.status === "accepted") {
          solved = true;
          const solveTimeSec = Math.floor(
            (sub.createdAt.getTime() - contest.startsAt.getTime()) / 1000
          );
          totalPenalty += solveTimeSec + wrongAttempts * 20 * 60;
          break;
        }
        wrongAttempts++;
      }

      if (solved) solvedCount++;
    }

    await prisma.contestParticipation.update({
      data: { penaltySeconds: totalPenalty, score: solvedCount },
      where: { id: participation.id }
    });
  } else {
    // IOI scoring
    const bestByProblem = new Map<string, number>();
    for (const sub of allSubmissions) {
      if (!contestProblems.has(sub.problemId)) continue;
      const current = bestByProblem.get(sub.problemId) ?? 0;
      if (sub.score > current) bestByProblem.set(sub.problemId, sub.score);
    }

    let totalScore = 0;
    const subtaskScores: Record<string, number> = {};
    for (const [problemId, best] of bestByProblem) {
      totalScore += best;
      subtaskScores[problemId] = best;
    }

    await prisma.contestParticipation.update({
      data: { score: totalScore, subtaskScores },
      where: { id: participation.id }
    });
  }
}

export interface TestcaseSetGroup {
  id: string;
  isHidden: boolean;
  name: string;
  testcases: ProblemJudgeTestcase[];
  weight: number;
}

export interface SubmissionJudgeContext {
  checkerScript: string | null;
  interactorScript: string | null;
  judgeType: JudgeType;
  memoryLimitMb: number;
  problemSlug: string;
  submissionType: SubmissionType;
  templates: {
    driverCode: string;
    insertionMarker: string;
    language: string;
    templateCode: string;
  }[];
  testcaseSets: TestcaseSetGroup[];
  testcases: ProblemJudgeTestcase[];
  timeLimitMs: number;
  pipelineConfig: PipelineConfig | null;
  scoringScript: string | null;
  scoringLanguage: string | null;
  artifactPatterns: string[];
  networkAccessConfig: NetworkAccessConfig | null;
}

export async function getSubmissionJudgeContext(
  submissionId: string
): Promise<SubmissionJudgeContext | null> {
  const submission = await prisma.submission.findUnique({
    include: {
      problem: {
        include: {
          templates: true,
          testcaseSets: {
            include: {
              testcases: { orderBy: { ordinal: "asc" } }
            },
            orderBy: { createdAt: "asc" }
          }
        }
      }
    },
    where: { id: submissionId }
  });

  if (!submission) return null;

  const testcaseSets: TestcaseSetGroup[] = submission.problem.testcaseSets.map((ts) => ({
    id: ts.id,
    isHidden: ts.isHidden,
    name: ts.name,
    testcases: ts.testcases.map((testcase) => ({
      expectedStdout: testcase.expectedStdout ?? undefined,
      id: testcase.id,
      inputFiles: (testcase.inputFiles as Record<string, string> | null) ?? undefined,
      isHidden: ts.isHidden,
      stdin: testcase.stdin,
      weight: ts.weight
    })),
    weight: ts.weight
  }));

  return {
    checkerScript: submission.problem.checkerScript,
    interactorScript: submission.problem.interactorScript,
    judgeType: submission.problem.judgeType,
    memoryLimitMb: submission.problem.memoryLimitMb,
    problemSlug: submission.problem.slug,
    submissionType: submission.problem.submissionType,
    templates: submission.problem.templates.map((t) => ({
      driverCode: t.driverCode,
      insertionMarker: t.insertionMarker,
      language: t.language,
      templateCode: t.templateCode
    })),
    testcaseSets,
    testcases: testcaseSets.flatMap((ts) => ts.testcases),
    timeLimitMs: submission.problem.timeLimitMs,
    pipelineConfig: submission.problem.pipelineConfig as PipelineConfig | null,
    scoringScript: submission.problem.scoringScript,
    scoringLanguage: submission.problem.scoringLanguage,
    artifactPatterns: submission.problem.artifactPatterns,
    networkAccessConfig: submission.problem.networkAccessConfig as NetworkAccessConfig | null
  };
}
