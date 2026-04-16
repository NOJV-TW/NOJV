import {
  assignRanks,
  groupByUser,
  resolveDisplayUsername,
  secondsSince,
  sortByScoreThenPenalty,
  splitFrozenVisible,
  type ParticipantRow,
  type ProblemScore,
  type ScoreboardEntry,
  type ScoreboardProblem,
  type SubmissionRow,
  type TimedSession
} from "./rank-util";

export function buildPointSumScoreboard(
  session: TimedSession,
  participants: ParticipantRow[],
  submissions: SubmissionRow[],
  problems: ScoreboardProblem[],
  showFrozen: boolean
): ScoreboardEntry[] {
  const frozenAt = session.frozenAt;

  // Track first full-score per problem (global). Submissions are sorted by
  // createdAt asc, so the first full score seen is the global first.
  const firstFullByProblem = new Map<string, string>();
  const pointsByProblem = new Map(problems.map((p) => [p.id, p.points]));
  for (const sub of submissions) {
    const maxPts = pointsByProblem.get(sub.problemId);
    if (maxPts != null && sub.score >= maxPts && !firstFullByProblem.has(sub.problemId)) {
      firstFullByProblem.set(sub.problemId, sub.userId);
    }
  }

  const subsByUser = groupByUser(submissions);

  const entries: ScoreboardEntry[] = participants.map((p) => {
    const userSubs = subsByUser.get(p.userId) ?? [];
    let totalScore = 0;
    let lastImprovementTime = 0;
    const problemScores: ProblemScore[] = [];
    const isFirstBlood: boolean[] = [];

    for (const prob of problems) {
      const probSubs = userSubs.filter((s) => s.problemId === prob.id);
      const { visibleSubs, isFrozen } = splitFrozenVisible(probSubs, frozenAt, showFrozen);

      let bestScore = 0;
      let firstAcTime: number | null = null;

      for (const sub of visibleSubs) {
        if (sub.score > bestScore) {
          bestScore = sub.score;
          const subTime = secondsSince(session.startsAt, sub.createdAt);
          if (subTime > lastImprovementTime) {
            lastImprovementTime = subTime;
          }
        }
        if (sub.score >= prob.points && firstAcTime == null) {
          firstAcTime = secondsSince(session.startsAt, sub.createdAt);
        }
      }

      totalScore += bestScore;

      problemScores.push({
        attempts: visibleSubs.length,
        firstAcTime,
        isFrozen,
        isPending: isFrozen,
        problemId: prob.id,
        score: bestScore
      });

      isFirstBlood.push(firstFullByProblem.get(prob.id) === p.userId && firstAcTime != null);
    }

    return {
      displayName: p.user.name,
      username: resolveDisplayUsername(p.user),
      isFirstBlood,
      problems: problemScores,
      rank: 0,
      totalPenalty: lastImprovementTime,
      totalScore,
      userId: p.userId
    };
  });

  // IOI reuses totalPenalty as lastImprovementTime for the secondary sort key
  sortByScoreThenPenalty(entries);

  // IOI ties on total score alone
  assignRanks(entries, (prev, curr) => prev.totalScore === curr.totalScore);

  return entries;
}
