import { prisma } from "@nojv/db";
import type {
  JudgeType,
  ProblemJudgeTestcase,
  SubmissionResult,
  SubmissionType
} from "@nojv/core";

export async function markSubmissionRunning(submissionId: string) {
  return prisma.submission.update({
    data: { status: "running" },
    where: { id: submissionId }
  });
}

export async function completeSubmission(submissionId: string, result: SubmissionResult) {
  const submission = await prisma.submission.update({
    data: {
      compilerOutput: result.verdict === "compile_error" ? result.feedback : null,
      runtimeMs: result.runtimeMs,
      score: result.score,
      status: result.verdict,
      verdictDetail: result,
      ...(result.subtaskResults ? { subtaskResults: result.subtaskResults } : {})
    },
    where: { id: submissionId }
  });

  // Update contest scores if this submission is part of a contest
  if (submission.contestParticipationId && !submission.sampleOnly) {
    await updateContestScoresAfterJudge(submission.contestParticipationId);
  }

  return submission;
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
    timeLimitMs: submission.problem.timeLimitMs
  };
}
