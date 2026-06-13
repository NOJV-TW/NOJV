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

const NON_PENALIZED_STATUSES = new Set([
  "queued",
  "compiling",
  "running",
  "pending_upload",
  "compile_error",
  "system_error",
]);

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

export function computeProblemCountPenalty(
  submissions: readonly ProblemCountScoringSubmission[],
  sessionStartsAt: Date,
  penaltyPerWrongSec: number = PROBLEM_COUNT_PENALTY_PER_WRONG_SEC,
): ProblemCountResult {
  let wrongAttempts = 0;
  for (const sub of submissions) {
    if (NON_PENALIZED_STATUSES.has(sub.status)) {
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
        penaltySeconds: firstAcTimeSec + wrongAttempts * penaltyPerWrongSec,
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

  const firstAcByProblem = new Map<string, string>();
  for (const sub of submissions) {
    if (sub.status === "accepted" && !firstAcByProblem.has(sub.problemId)) {
      firstAcByProblem.set(sub.problemId, sub.userId);
    }
  }

  const subsByUser = groupByUser(submissions);
  const penaltyPerWrongSec = session.penaltyPerWrongSec ?? PROBLEM_COUNT_PENALTY_PER_WRONG_SEC;

  const entries: ScoreboardEntry[] = participants.map((p) => {
    const userSubs = subsByUser.get(p.userId) ?? [];
    let totalScore = 0;
    let totalPenalty = 0;
    const problemScores: ProblemScore[] = [];
    const isFirstBlood: boolean[] = [];

    for (const prob of problems) {
      const probSubs = userSubs.filter((s) => s.problemId === prob.id);
      const { visibleSubs, isFrozen } = splitFrozenVisible(probSubs, frozenAt, showFrozen);

      const result = computeProblemCountPenalty(
        visibleSubs,
        session.startsAt,
        penaltyPerWrongSec,
      );
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

  assignRanks(
    entries,
    (prev, curr) =>
      prev.totalScore === curr.totalScore && prev.totalPenalty === curr.totalPenalty,
  );

  return entries;
}
