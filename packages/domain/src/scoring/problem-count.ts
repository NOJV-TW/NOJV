import {
  assignRanks,
  groupByUser,
  resolveDisplayUsername,
  sortByScoreThenPenalty,
  splitFrozenVisible,
  type ParticipantRow,
  type ProblemScore,
  type ScoreboardEntry,
  type ScoreboardProblem,
  type SubmissionRow,
  type TimedSession,
} from "./rank-util";

export const PROBLEM_COUNT_PENALTY_PER_WRONG_SEC = 20 * 60;

interface ProblemCountScoringSubmission {
  status: string;
  createdAt: Date;
}

export interface ProblemCountResult {
  solved: boolean;
  wrongAttempts: number;
  firstAcTimeSec: number | null;
  penaltySeconds: number;
}

// Single source of truth for ICPC per-problem penalty; shared with the DB-write path.
export function computeProblemCountPenalty(
  submissions: readonly ProblemCountScoringSubmission[],
  sessionStartsAt: Date,
): ProblemCountResult {
  let wrongAttempts = 0;
  for (const sub of submissions) {
    if (sub.status === "queued" || sub.status === "compiling" || sub.status === "running") {
      continue;
    }
    if (sub.status === "accepted") {
      const firstAcTimeSec = Math.max(
        0,
        Math.floor((sub.createdAt.getTime() - sessionStartsAt.getTime()) / 1000),
      );
      return {
        solved: true,
        wrongAttempts,
        firstAcTimeSec,
        penaltySeconds: firstAcTimeSec + wrongAttempts * PROBLEM_COUNT_PENALTY_PER_WRONG_SEC,
      };
    }
    wrongAttempts++;
  }
  return {
    solved: false,
    wrongAttempts,
    firstAcTimeSec: null,
    penaltySeconds: 0,
  };
}

export function buildProblemCountScoreboard(
  session: TimedSession,
  participants: ParticipantRow[],
  submissions: SubmissionRow[],
  problems: ScoreboardProblem[],
  showFrozen: boolean,
): ScoreboardEntry[] {
  const frozenAt = session.frozenAt;

  // Track first AC per problem (global, unfrozen). Submissions are sorted by
  // createdAt asc, so the first AC seen is the global first blood.
  const firstAcByProblem = new Map<string, string>();
  for (const sub of submissions) {
    if (sub.status === "accepted" && !firstAcByProblem.has(sub.problemId)) {
      firstAcByProblem.set(sub.problemId, sub.userId);
    }
  }

  const subsByUser = groupByUser(submissions);

  const entries: ScoreboardEntry[] = participants.map((p) => {
    const userSubs = subsByUser.get(p.userId) ?? [];
    let totalScore = 0;
    let totalPenalty = 0;
    const problemScores: ProblemScore[] = [];
    const isFirstBlood: boolean[] = [];

    for (const prob of problems) {
      const probSubs = userSubs.filter((s) => s.problemId === prob.id);
      const { visibleSubs, isFrozen } = splitFrozenVisible(probSubs, frozenAt, showFrozen);

      // Single source of truth for ICPC per-problem penalty. Shared with
      // the DB-write path in updateContestScores so the two can't drift.
      const result = computeProblemCountPenalty(visibleSubs, session.startsAt);
      const score = result.solved ? prob.points : 0;
      if (result.solved) {
        totalScore += prob.points;
        totalPenalty += result.penaltySeconds;
      }

      problemScores.push({
        attempts: result.wrongAttempts,
        firstAcTime: result.firstAcTimeSec,
        isFrozen,
        isPending: isFrozen,
        problemId: prob.id,
        score,
      });

      isFirstBlood.push(
        firstAcByProblem.get(prob.id) === p.userId && result.firstAcTimeSec != null,
      );
    }

    return {
      displayName: p.user.name,
      username: resolveDisplayUsername(p.user),
      isFirstBlood,
      problems: problemScores,
      rank: 0,
      totalPenalty,
      totalScore,
      userId: p.userId,
    };
  });

  sortByScoreThenPenalty(entries);

  // Same score+penalty = same rank
  assignRanks(
    entries,
    (prev, curr) =>
      prev.totalScore === curr.totalScore && prev.totalPenalty === curr.totalPenalty,
  );

  return entries;
}
