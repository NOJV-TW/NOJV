import { prisma } from "@nojv/db";

/**
 * Update contest participation scores after a submission is judged.
 *
 * ICPC scoring: solved problems count as score, penalty = time from contest
 * start + 20min per wrong attempt on solved problems.
 *
 * IOI scoring: per-problem best score across all submissions.
 */
export async function updateContestScores(submissionId: string): Promise<void> {
  const submission = await prisma.submission.findUnique({
    include: {
      contestParticipation: {
        include: {
          contest: {
            include: {
              problems: { orderBy: { ordinal: "asc" } }
            }
          }
        }
      }
    },
    where: { id: submissionId }
  });

  if (!submission?.contestParticipation) return;

  const { contest } = submission.contestParticipation;
  const participation = submission.contestParticipation;

  // Use contestId + userId for direct lookup (avoids relying solely on participationId)
  const allSubmissions = await prisma.submission.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      problemId: true,
      score: true,
      status: true
    },
    where: {
      contestId: contest.id,
      userId: submission.userId,
      sampleOnly: false
    }
  });

  if (contest.scoringMode === "icpc") {
    await updateIcpcScores(participation.id, contest, allSubmissions);
  } else {
    await updateIoiScores(participation.id, contest, allSubmissions);
  }
}

async function updateIcpcScores(
  participationId: string,
  contest: {
    problems: { points: number; problemId: string }[];
    startsAt: Date;
  },
  submissions: {
    createdAt: Date;
    problemId: string;
    score: number;
    status: string;
  }[]
) {
  const contestProblems = new Set(contest.problems.map((p) => p.problemId));
  let solvedCount = 0;
  let totalPenalty = 0;

  // Group submissions by problem
  const byProblem = new Map<string, typeof submissions>();
  for (const sub of submissions) {
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
        const solveTimeMs = sub.createdAt.getTime() - contest.startsAt.getTime();
        const solveTimeSec = Math.floor(solveTimeMs / 1000);
        totalPenalty += solveTimeSec + wrongAttempts * 20 * 60;
        break;
      }
      wrongAttempts++;
    }

    if (solved) solvedCount++;
  }

  await prisma.contestParticipation.update({
    data: {
      penaltySeconds: totalPenalty,
      score: solvedCount
    },
    where: { id: participationId }
  });
}

async function updateIoiScores(
  participationId: string,
  contest: {
    problems: { points: number; problemId: string }[];
    startsAt: Date;
  },
  submissions: {
    createdAt: Date;
    problemId: string;
    score: number;
    status: string;
  }[]
) {
  const contestProblems = new Map(contest.problems.map((p) => [p.problemId, p]));
  const bestByProblem = new Map<string, number>();

  for (const sub of submissions) {
    if (!contestProblems.has(sub.problemId)) continue;
    const current = bestByProblem.get(sub.problemId) ?? 0;
    if (sub.score > current) {
      bestByProblem.set(sub.problemId, sub.score);
    }
  }

  let totalScore = 0;
  const subtaskScores: Record<string, number> = {};

  for (const [problemId, best] of bestByProblem) {
    totalScore += best;
    subtaskScores[problemId] = best;
  }

  await prisma.contestParticipation.update({
    data: {
      score: totalScore,
      subtaskScores
    },
    where: { id: participationId }
  });
}
