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
  type TimedSession
} from "./rank-util";

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
// display-read path in buildIcpcScoreboard below. Keeping one function
// prevents the two from drifting apart (historical bug: round 12 fixed the
// scoring path, round 16 then had to fix the scoreboard path with the same
// change).
//
// In-progress statuses (queued/compiling/running) are skipped — they aren't
// verdicts yet. The next recalc picks them up once judging completes.
// `firstAcTimeSec` is clamped to [0, ∞) for the pathological case of a
// submission timestamp before the session start.
export function computeIcpcProblemPenalty(
  submissions: readonly IcpcScoringSubmission[],
  sessionStartsAt: Date
): IcpcProblemResult {
  let wrongAttempts = 0;
  for (const sub of submissions) {
    if (sub.status === "queued" || sub.status === "compiling" || sub.status === "running") {
      continue;
    }
    if (sub.status === "accepted") {
      const firstAcTimeSec = Math.max(
        0,
        Math.floor((sub.createdAt.getTime() - sessionStartsAt.getTime()) / 1000)
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

export function buildIcpcScoreboard(
  session: TimedSession,
  participants: ParticipantRow[],
  submissions: SubmissionRow[],
  problems: ScoreboardProblem[],
  showFrozen: boolean
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
      const result = computeIcpcProblemPenalty(visibleSubs, session.startsAt);
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
        score
      });

      isFirstBlood.push(
        firstAcByProblem.get(prob.id) === p.userId && result.firstAcTimeSec != null
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
      userId: p.userId
    };
  });

  sortByScoreThenPenalty(entries);

  // Same score+penalty = same rank
  assignRanks(
    entries,
    (prev, curr) =>
      prev.totalScore === curr.totalScore && prev.totalPenalty === curr.totalPenalty
  );

  return entries;
}
