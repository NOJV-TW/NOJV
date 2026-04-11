import { contestParticipationRepo, submissionRepo } from "@nojv/db";
import { scoreboard } from "@nojv/redis";

export const ICPC_PENALTY_PER_WRONG_SEC = 20 * 60;

interface IcpcScoringSubmission {
  status: string;
  createdAt: Date;
}

export interface IcpcProblemResult {
  solved: boolean;
  wrongAttempts: number;
  firstAcTimeSec: number | null;
  penaltySeconds: number;
}

// Pure helper: compute the ICPC verdict + penalty for ONE (participant, problem)
// pair from that participant's ordered submissions to that problem. The
// outer caller aggregates across problems.
//
// Shared by BOTH paths — the DB-write path in updateContestScores and the
// display-read path in scoreboard.ts::buildIcpcScoreboard. Keeping one
// function prevents the two from drifting apart (historical bug: round 12
// fixed the scoring path, round 16 then had to fix the scoreboard path
// with the same change).
//
// In-progress statuses (queued/compiling/running) are skipped — they aren't
// verdicts yet. The next recalc picks them up once judging completes.
// `firstAcTimeSec` is clamped to [0, ∞) for the pathological case of a
// submission timestamp before the contest start.
export function computeIcpcProblemPenalty(
  submissions: readonly IcpcScoringSubmission[],
  contestStartsAt: Date
): IcpcProblemResult {
  let wrongAttempts = 0;
  for (const sub of submissions) {
    if (sub.status === "queued" || sub.status === "compiling" || sub.status === "running") {
      continue;
    }
    if (sub.status === "accepted") {
      const firstAcTimeSec = Math.max(
        0,
        Math.floor((sub.createdAt.getTime() - contestStartsAt.getTime()) / 1000)
      );
      return {
        solved: true,
        wrongAttempts,
        firstAcTimeSec,
        penaltySeconds: firstAcTimeSec + wrongAttempts * ICPC_PENALTY_PER_WRONG_SEC
      };
    }
    wrongAttempts++;
  }
  return {
    solved: false,
    wrongAttempts,
    firstAcTimeSec: null,
    penaltySeconds: 0
  };
}

export async function updateContestScores(contestParticipationId: string): Promise<void> {
  const participation =
    await contestParticipationRepo.findByIdWithContest(contestParticipationId);

  if (!participation) return;

  const { contest } = participation;

  const allSubmissions = await submissionRepo.findForParticipationScoring(participation.id);

  const contestProblems = new Map(contest.problems.map((p) => [p.problemId, p]));

  if (contest.scoringMode === "problem_count") {
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
      const { solved, penaltySeconds } = computeIcpcProblemPenalty(
        problemSubs,
        contest.startsAt
      );
      if (solved) {
        solvedCount++;
        totalPenalty += penaltySeconds;
      }
    }

    await contestParticipationRepo.update(participation.id, {
      penaltySeconds: totalPenalty,
      score: solvedCount
    });

    const icpcScore = solvedCount * 1e9 - totalPenalty;
    await scoreboard.updateScoreboard(contest.id, participation.id, icpcScore);
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

    await contestParticipationRepo.update(participation.id, {
      score: totalScore,
      subtaskScores
    });

    await scoreboard.updateScoreboard(contest.id, participation.id, totalScore);
  }
}
