import { prisma } from "@nojv/db";

import { getRedis, updateScoreboard } from "./redis";

export interface ContestInfo {
  endsAt: string;
  freezeTime: string | null;
  scoringMode: string;
  startsAt: string;
}

export async function getContestInfo(contestId: string): Promise<ContestInfo> {
  const contest = await prisma.contest.findUniqueOrThrow({
    select: {
      endsAt: true,
      frozenAt: true,
      scoringMode: true,
      startsAt: true
    },
    where: { id: contestId }
  });

  return {
    endsAt: contest.endsAt.toISOString(),
    freezeTime: contest.frozenAt?.toISOString() ?? null,
    scoringMode: contest.scoringMode,
    startsAt: contest.startsAt.toISOString()
  };
}

export async function activateContest(contestId: string): Promise<void> {
  await prisma.contest.update({
    data: { visibility: "published" },
    where: { id: contestId }
  });
}

export async function freezeScoreboard(contestId: string): Promise<void> {
  const redis = getRedis();
  const src = `nojv:scoreboard:${contestId}`;
  const dst = `nojv:scoreboard:${contestId}:frozen`;
  await redis.rename(src, dst);

  await prisma.contest.update({
    data: { frozenBoard: true },
    where: { id: contestId }
  });
}

export async function finalizeContest(contestId: string): Promise<void> {
  const redis = getRedis();
  const frozenKey = `nojv:scoreboard:${contestId}:frozen`;
  const exists = await redis.exists(frozenKey);
  if (exists) {
    await redis.rename(frozenKey, `nojv:scoreboard:${contestId}`);
  }

  await prisma.contest.update({
    data: { frozenBoard: false, visibility: "archived" },
    where: { id: contestId }
  });
}

export async function updateContestScores(contestParticipationId: string): Promise<void> {
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

    const icpcScore = solvedCount * 1e9 - totalPenalty;
    await updateScoreboard(contest.id, participation.id, icpcScore, contest.scoringMode);
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

    await updateScoreboard(contest.id, participation.id, totalScore, contest.scoringMode);
  }
}
