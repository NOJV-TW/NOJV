import {
  contestRepo,
  contestParticipationRepo,
  ParticipationVersionConflict,
  scoreOverrideRepo,
  submissionRepo,
} from "@nojv/db";
import type { ContestScoringMode, ScoreboardMode } from "@nojv/core";

import { ConflictError, NotFoundError } from "../shared/errors";
import {
  buildScoreboard,
  buildScoreboardChartSeries,
  computeProblemCountPenalty,
  type ParticipantRow,
  type ScoreboardEntry,
  type ScoreboardProblem,
  type SubmissionRow,
  type TimedSession,
} from "../scoring";

export type { ProblemScore, ScoreboardEntry, ScoreboardProblem } from "../scoring";

export interface Scoreboard {
  entries: ScoreboardEntry[];
  problems: ScoreboardProblem[];
  scoringMode: ContestScoringMode;
  scoreboardMode: ScoreboardMode;
  frozenAt: string | null;
  isFrozen: boolean;
}

export interface ScoreboardChart {
  series: {
    userId: string;
    username: string;
    points: { time: number; score: number }[];
  }[];
}

const SCORE_UPDATE_MAX_ATTEMPTS = 3;

type ContestParticipationWithContest = NonNullable<
  Awaited<ReturnType<typeof contestParticipationRepo.findByIdWithContest>>
>;
type ContestSubmissionRows = Awaited<
  ReturnType<typeof submissionRepo.findForParticipationScoring>
>;
type ContestProblemMap = Map<
  string,
  ContestParticipationWithContest["contest"]["problems"][number]
>;
type ContestOverrideRows = Awaited<ReturnType<typeof scoreOverrideRepo.findAllByContext>>;

async function persistContestProblemCountScore(
  participation: ContestParticipationWithContest,
  allSubmissions: ContestSubmissionRows,
  contestProblems: ContestProblemMap,
): Promise<void> {
  const { contest } = participation;
  let solvedCount = 0;
  let totalPenalty = 0;

  const byProblem = new Map<string, ContestSubmissionRows>();
  for (const sub of allSubmissions) {
    if (!contestProblems.has(sub.problemId)) continue;
    const existing = byProblem.get(sub.problemId) ?? [];
    existing.push(sub);
    byProblem.set(sub.problemId, existing);
  }

  for (const [, problemSubs] of byProblem) {
    const { solved, penaltySeconds } = computeProblemCountPenalty(
      problemSubs,
      contest.startsAt,
    );
    if (solved) {
      solvedCount++;
      totalPenalty += penaltySeconds;
    }
  }

  await contestParticipationRepo.updateWithVersion(participation.id, participation.version, {
    penaltySeconds: totalPenalty,
    score: solvedCount,
  });
}

async function persistContestBestScore(
  participation: ContestParticipationWithContest,
  allSubmissions: ContestSubmissionRows,
  contestProblems: ContestProblemMap,
  overrideRows: ContestOverrideRows,
): Promise<void> {
  const bestByProblem = new Map<string, number>();
  for (const sub of allSubmissions) {
    if (!contestProblems.has(sub.problemId)) continue;
    const current = bestByProblem.get(sub.problemId) ?? 0;
    if (sub.score > current) bestByProblem.set(sub.problemId, sub.score);
  }

  for (const row of overrideRows) {
    if (row.userId !== participation.userId) continue;
    if (!contestProblems.has(row.problemId)) continue;
    bestByProblem.set(row.problemId, row.overrideScore);
  }

  let totalScore = 0;
  const subtaskScores: Record<string, number> = {};
  for (const [problemId, best] of bestByProblem) {
    totalScore += best;
    subtaskScores[problemId] = best;
  }

  await contestParticipationRepo.updateWithVersion(participation.id, participation.version, {
    score: totalScore,
    subtaskScores,
  });
}

export async function updateContestScores(
  contestParticipationId: string,
): Promise<string | null> {
  let overrideRows: ContestOverrideRows | undefined;

  for (let attempt = 1; attempt <= SCORE_UPDATE_MAX_ATTEMPTS; attempt++) {
    const participation =
      await contestParticipationRepo.findByIdWithContest(contestParticipationId);

    if (!participation) return null;

    const { contest } = participation;

    const allSubmissions = await submissionRepo.findForParticipationScoring(participation.id);

    const contestProblems = new Map(contest.problems.map((p) => [p.problemId, p]));

    try {
      if (contest.scoringMode === "problem_count") {
        await persistContestProblemCountScore(participation, allSubmissions, contestProblems);
      } else {
        overrideRows ??= await scoreOverrideRepo.findAllByContext("contest", contest.id);
        await persistContestBestScore(
          participation,
          allSubmissions,
          contestProblems,
          overrideRows,
        );
      }

      return contest.id;
    } catch (err) {
      if (err instanceof ParticipationVersionConflict) {
        continue;
      }
      throw err;
    }
  }

  throw new ConflictError(
    `Could not persist score for participation ${contestParticipationId} after ${String(SCORE_UPDATE_MAX_ATTEMPTS)} attempts.`,
  );
}

export async function getScoreboard(
  contestId: string,
  options?: { canSeeLive?: boolean },
): Promise<Scoreboard> {
  const canSeeLive = options?.canSeeLive === true;
  const contest = await contestRepo.findForScoreboardById(contestId);

  if (!contest || contest.visibility === "draft") {
    throw new NotFoundError("Contest not found.");
  }

  const now = new Date();
  const scoreboardMode = contest.scoreboardMode;
  const showFrozen =
    !canSeeLive &&
    (scoreboardMode === "frozen" ||
      (contest.frozenBoard && contest.frozenAt != null && now > contest.frozenAt));

  const problems: ScoreboardProblem[] = contest.problems.map((cp) => ({
    id: cp.problemId,
    ordinal: cp.ordinal,
    points: cp.points,
    title: cp.problem.title,
  }));

  const scoringMode = contest.scoringMode;

  if (scoreboardMode === "hidden" && !canSeeLive) {
    return {
      entries: [],
      frozenAt: contest.frozenAt?.toISOString() ?? null,
      isFrozen: false,
      problems,
      scoreboardMode,
      scoringMode,
    };
  }

  if (contest.participations.length === 0) {
    return {
      entries: [],
      frozenAt: contest.frozenAt?.toISOString() ?? null,
      isFrozen: showFrozen,
      problems,
      scoreboardMode,
      scoringMode,
    };
  }

  const participationIds = contest.participations.map((p) => p.id);
  const allSubmissions = await submissionRepo.findForContestScoreboard(participationIds);

  const submissions: SubmissionRow[] = allSubmissions.map((s) => ({
    createdAt: s.createdAt,
    problemId: s.problemId,
    score: s.score,
    status: s.status,
    userId: s.contestParticipation?.userId ?? "",
  }));

  const participants: ParticipantRow[] = contest.participations;

  const session: TimedSession = {
    id: contest.id,
    startsAt: contest.startsAt,
    endsAt: contest.endsAt,
    frozenAt: contest.frozenAt,
  };

  const entries = buildScoreboard(
    session,
    scoringMode,
    participants,
    submissions,
    problems,
    showFrozen,
  );

  return {
    entries,
    frozenAt: contest.frozenAt?.toISOString() ?? null,
    isFrozen: showFrozen,
    problems,
    scoreboardMode,
    scoringMode,
  };
}

export async function getScoreboardChart(
  contestId: string,
  topN: number,
  options?: { canSeeLive?: boolean },
): Promise<ScoreboardChart> {
  const scoreboardData = await getScoreboard(contestId, {
    canSeeLive: options?.canSeeLive === true,
  });

  const topEntries = scoreboardData.entries.slice(0, topN);
  if (topEntries.length === 0) {
    return { series: [] };
  }

  const topUserIds = new Set(topEntries.map((e) => e.userId));

  const pointsMap = new Map(scoreboardData.problems.map((p) => [p.id, p.points]));

  const contest = await contestRepo.findForChartById(contestId, [...topUserIds]);

  if (!contest) return { series: [] };

  const participationUserMap = new Map(contest.participations.map((p) => [p.id, p.userId]));

  const participationIds = contest.participations.map((p) => p.id);
  const submissions = await submissionRepo.findForContestChart(participationIds);

  const frozenCutoff =
    scoreboardData.isFrozen && scoreboardData.frozenAt
      ? new Date(scoreboardData.frozenAt)
      : null;

  const submissionsByUser = new Map<string, SubmissionRow[]>();
  for (const sub of submissions) {
    if (frozenCutoff && sub.createdAt > frozenCutoff) continue;
    const userId = participationUserMap.get(sub.contestParticipationId ?? "");
    if (!userId) continue;
    const row: SubmissionRow = {
      createdAt: sub.createdAt,
      problemId: sub.problemId,
      score: sub.score,
      status: sub.status,
      userId,
    };
    const existing = submissionsByUser.get(userId);
    if (existing) existing.push(row);
    else submissionsByUser.set(userId, [row]);
  }

  const usernameMap = new Map(topEntries.map((e) => [e.userId, e.username]));

  const series = buildScoreboardChartSeries(
    contest.startsAt,
    scoreboardData.scoringMode,
    [...topUserIds],
    submissionsByUser,
    usernameMap,
    pointsMap,
  );

  return { series };
}
