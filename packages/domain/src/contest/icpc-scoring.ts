import { computeIcpcProblemPenalty } from "./scoring";
import {
  assignRanks,
  groupByUser,
  resolveDisplayUsername,
  type ContestRow,
  type ParticipantRow,
  type ProblemScore,
  type ScoreboardEntry,
  type ScoreboardProblem,
  type SubmissionRow
} from "./rank-util";

export function buildIcpcScoreboard(
  contest: ContestRow,
  participants: ParticipantRow[],
  submissions: SubmissionRow[],
  problems: ScoreboardProblem[],
  showFrozen: boolean
): ScoreboardEntry[] {
  const frozenAt = contest.frozenAt;

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
      const frozenSubs = frozenAt ? probSubs.filter((s) => s.createdAt > frozenAt) : [];
      const visibleSubs =
        showFrozen && frozenAt ? probSubs.filter((s) => s.createdAt <= frozenAt) : probSubs;

      const isFrozen = showFrozen && frozenSubs.length > 0;
      const isPending = isFrozen;

      // Single source of truth for ICPC per-problem penalty. Shared with
      // the DB-write path in updateContestScores so the two can't drift.
      const result = computeIcpcProblemPenalty(visibleSubs, contest.startsAt);
      const score = result.solved ? prob.points : 0;
      if (result.solved) {
        totalScore += prob.points;
        totalPenalty += result.penaltySeconds;
      }

      problemScores.push({
        attempts: result.wrongAttempts,
        firstAcTime: result.firstAcTimeSec,
        isFrozen,
        isPending,
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

  // Sort: totalScore DESC, totalPenalty ASC
  entries.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.totalPenalty - b.totalPenalty;
  });

  // Same score+penalty = same rank
  assignRanks(
    entries,
    (prev, curr) =>
      prev.totalScore === curr.totalScore && prev.totalPenalty === curr.totalPenalty
  );

  return entries;
}
