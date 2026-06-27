import {
  participationRepo,
  UnifiedParticipationVersionConflict,
  scoreOverrideRepo,
  submissionRepo,
} from "@nojv/db";

import { runScoreUpdate } from "../scoring";

export type { ProblemScore, ScoreboardEntry, ScoreboardProblem } from "../scoring";

type ExamParticipationWithExam = NonNullable<
  Awaited<ReturnType<typeof participationRepo.findExamForScoring>>
>;

export async function updateExamScores(examId: string, userId: string): Promise<void> {
  await runScoreUpdate<ExamParticipationWithExam>(`${examId}:${userId}`, {
    load: () => participationRepo.findExamForScoring(examId, userId),
    submissions: (p) =>
      submissionRepo.findMany({
        where: { examId: p.exam.id, userId: p.userId, sampleOnly: false },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, problemId: true, score: true, status: true },
      }),
    overrides: (p) => scoreOverrideRepo.findAllByContext("exam", p.exam.id),
    problemIds: (p) => new Set(p.exam.problems.map((ep) => ep.problemId)),
    problemPoints: (p) => new Map(p.exam.problems.map((ep) => [ep.problemId, ep.points])),
    scoringMode: (p) => p.exam.scoringMode,
    startsAt: (p) => p.exam.startsAt,
    userId: (p) => p.userId,
    persist: (p, fields) => participationRepo.updateWithVersion(p.id, p.version, fields),
    isConflict: (err) => err instanceof UnifiedParticipationVersionConflict,
  });
}
