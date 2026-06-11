import {
  examRepo,
  examParticipationRepo,
  ExamParticipationVersionConflict,
  scoreOverrideRepo,
  submissionRepo,
} from "@nojv/db";
import type { ContestScoringMode, ScoreboardMode } from "@nojv/core";

import { ConflictError, NotFoundError } from "../shared/errors";
import {
  buildScoreboard,
  computeBestScoreState,
  computeProblemCountState,
  type ParticipantRow,
  type ScoreboardEntry,
  type ScoreboardProblem,
  type SubmissionRow,
  type TimedSession,
} from "../scoring";

export type { ProblemScore, ScoreboardEntry, ScoreboardProblem } from "../scoring";

export interface ExamScoreboard {
  entries: ScoreboardEntry[];
  problems: ScoreboardProblem[];
  scoringMode: ContestScoringMode;
  scoreboardMode: ScoreboardMode;
}

const SCORE_UPDATE_MAX_ATTEMPTS = 3;

type ExamParticipationWithExam = NonNullable<
  Awaited<ReturnType<typeof examParticipationRepo.findByIdWithExam>>
>;
type ExamSubmissionRows = Awaited<ReturnType<typeof submissionRepo.findMany>>;
type ExamProblemMap = Map<string, ExamParticipationWithExam["exam"]["problems"][number]>;
type OverrideRows = Awaited<ReturnType<typeof scoreOverrideRepo.findAllByContext>>;

async function persistProblemCountScore(
  participation: ExamParticipationWithExam,
  allSubmissions: ExamSubmissionRows,
  examProblems: ExamProblemMap,
): Promise<void> {
  const { score, penaltySeconds } = computeProblemCountState({
    submissions: allSubmissions,
    problemIds: new Set(examProblems.keys()),
    startsAt: participation.exam.startsAt,
  });

  await examParticipationRepo.updateWithVersion(participation.id, participation.version, {
    penaltySeconds,
    score,
  });
}

async function persistBestScore(
  participation: ExamParticipationWithExam,
  allSubmissions: ExamSubmissionRows,
  examProblems: ExamProblemMap,
  overrideRows: OverrideRows,
): Promise<void> {
  const { totalScore, subtaskScores } = computeBestScoreState({
    submissions: allSubmissions,
    problemIds: new Set(examProblems.keys()),
    overrides: overrideRows,
    userId: participation.userId,
  });

  await examParticipationRepo.updateWithVersion(participation.id, participation.version, {
    score: totalScore,
    subtaskScores,
  });
}

export async function updateExamScores(examParticipationId: string): Promise<void> {
  let overrideRows: OverrideRows | undefined;

  for (let attempt = 1; attempt <= SCORE_UPDATE_MAX_ATTEMPTS; attempt++) {
    const participation = await examParticipationRepo.findByIdWithExam(examParticipationId);

    if (!participation) return;

    const { exam } = participation;

    const allSubmissions = await submissionRepo.findMany({
      where: {
        examId: exam.id,
        userId: participation.userId,
        sampleOnly: false,
      },
      orderBy: { createdAt: "asc" },
      select: {
        createdAt: true,
        problemId: true,
        score: true,
        status: true,
      },
    });

    const examProblems = new Map(exam.problems.map((p) => [p.problemId, p]));

    try {
      if (exam.scoringMode === "problem_count") {
        await persistProblemCountScore(participation, allSubmissions, examProblems);
      } else {
        overrideRows ??= await scoreOverrideRepo.findAllByContext("exam", exam.id);
        await persistBestScore(participation, allSubmissions, examProblems, overrideRows);
      }

      return;
    } catch (err) {
      if (err instanceof ExamParticipationVersionConflict) {
        continue;
      }
      throw err;
    }
  }

  throw new ConflictError(
    `Could not persist score for exam participation ${examParticipationId} after ${String(SCORE_UPDATE_MAX_ATTEMPTS)} attempts.`,
  );
}

/**
 * Recompute persisted exam scores for a (exam, user) pair after their submission
 * is judged. Mirrors the contest path (`updateContestScores`): the judge workflow
 * knows the examId + userId but not the participation id, so resolve it here.
 * No-ops if the user has no participation row yet.
 */
export async function updateExamScoresForUser(examId: string, userId: string): Promise<void> {
  const participationId = await examParticipationRepo.findIdByExamAndUser(examId, userId);
  if (participationId) {
    await updateExamScores(participationId);
  }
}

export async function getExamScoreboard(
  examId: string,
  options?: { isPrivileged?: boolean },
): Promise<ExamScoreboard> {
  const exam = await examRepo.findForScoreboard(examId);

  if (exam?.status !== "published") {
    throw new NotFoundError("Exam not found.");
  }

  const scoreboardMode = exam.scoreboardMode;

  const problems: ScoreboardProblem[] = exam.problems.map((ep) => ({
    id: ep.problemId,
    ordinal: ep.ordinal,
    points: ep.points,
    title: ep.problem.title,
  }));

  const scoringMode = exam.scoringMode;

  if (scoreboardMode === "hidden" && !options?.isPrivileged) {
    return {
      entries: [],
      problems,
      scoreboardMode,
      scoringMode,
    };
  }

  if (exam.participations.length === 0) {
    return {
      entries: [],
      problems,
      scoreboardMode,
      scoringMode,
    };
  }

  const rawSubmissions = await submissionRepo.findMany({
    where: {
      examId: exam.id,
      sampleOnly: false,
    },
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      problemId: true,
      score: true,
      status: true,
      userId: true,
    },
  });

  const submissions: SubmissionRow[] = rawSubmissions.map((s) => ({
    createdAt: s.createdAt,
    problemId: s.problemId,
    score: s.score,
    status: s.status,
    userId: s.userId,
  }));

  const participants: ParticipantRow[] = exam.participations;

  const session: TimedSession = {
    id: exam.id,
    startsAt: exam.startsAt,
    endsAt: exam.endsAt,
    frozenAt: null,
  };

  const entries = buildScoreboard(
    session,
    scoringMode,
    participants,
    submissions,
    problems,
    false,
  );

  return {
    entries,
    problems,
    scoreboardMode,
    scoringMode,
  };
}
