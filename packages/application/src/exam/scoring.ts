import {
  participationRepo,
  gradingRepo,
  runTransaction,
  scoreOverrideRepo,
  submissionRepo,
} from "@nojv/db";
import { ConflictError } from "../shared/errors";
import { getProblemTotalScores, requireProblemTotalScore } from "../problem/total-score";
import { computeBestScoreState } from "../scoring/persist-core";
import { activityScore, sumActivityScores } from "../scoring/activity-points";

export type { ProblemScore, ScoreboardEntry, ScoreboardProblem } from "../scoring";

export async function updateExamScores(examId: string, userId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = await participationRepo.findExamForScoring(examId, userId);
    if (!p) return;
    const [submissions, overrides, maxima] = await Promise.all([
      submissionRepo.findMany({
        where: { examId, userId, sampleOnly: false, createdAt: { lt: p.exam.endsAt } },
        select: { problemId: true, score: true },
      }),
      scoreOverrideRepo.findForExamUser(examId, userId),
      getProblemTotalScores(p.exam.problems.map((ep) => ep.problemId)),
    ]);
    const best = computeBestScoreState({
      submissions,
      overrides,
      userId,
      problemIds: new Set(p.exam.problems.map((ep) => ep.problemId)),
    });
    const weighted = p.exam.problems.map((ep) => ({
      id: ep.problemId,
      score: activityScore(
        best.subtaskScores[ep.problemId] ?? 0,
        requireProblemTotalScore(maxima, ep.problemId),
        ep.points,
      ),
    }));
    const subtaskScores = Object.fromEntries(weighted.map((p) => [p.id, p.score.toNumber()]));
    const saved = await runTransaction((tx) =>
      gradingRepo.persistExamScore(tx, {
        id: p.id,
        examId,
        version: p.version,
        gradingRevision: p.exam.gradingRevision,
        score: sumActivityScores(weighted.map((p) => p.score)),
        subtaskScores,
      }),
    );
    if (saved) return;
  }
  throw new ConflictError(
    "Exam grading changed while scores were being calculated. Retry convergence.",
  );
}
