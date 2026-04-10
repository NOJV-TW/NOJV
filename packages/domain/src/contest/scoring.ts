import { contestParticipationRepo, submissionRepo } from "@nojv/db";
import { scoreboard } from "@nojv/redis";

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
