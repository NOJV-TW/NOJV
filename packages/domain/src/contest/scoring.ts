import {
  contestRepo,
  contestParticipationRepo,
  scoreOverrideRepo,
  submissionRepo,
} from "@nojv/db";
import type { ContestScoringMode, ScoreboardMode } from "@nojv/core";
import { scoreboard } from "@nojv/redis";

import { NotFoundError } from "../shared/errors";
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

export interface ScoreboardData {
  entries: ScoreboardEntry[];
  problems: ScoreboardProblem[];
  scoringMode: ContestScoringMode;
  scoreboardMode: ScoreboardMode;
  frozenAt: string | null;
  isFrozen: boolean;
}

export interface ChartData {
  series: {
    userId: string;
    username: string;
    points: { time: number; score: number }[];
  }[];
}

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
      const { solved, penaltySeconds } = computeProblemCountPenalty(
        problemSubs,
        contest.startsAt,
      );
      if (solved) {
        solvedCount++;
        totalPenalty += penaltySeconds;
      }
    }

    await contestParticipationRepo.update(participation.id, {
      penaltySeconds: totalPenalty,
      score: solvedCount,
    });

    const packedScore = solvedCount * 1e9 - totalPenalty;
    await scoreboard.updateScoreboard(contest.id, participation.id, packedScore);
  } else {
    const bestByProblem = new Map<string, number>();
    for (const sub of allSubmissions) {
      if (!contestProblems.has(sub.problemId)) continue;
      const current = bestByProblem.get(sub.problemId) ?? 0;
      if (sub.score > current) bestByProblem.set(sub.problemId, sub.score);
    }

    // Overlay any per-problem overrides for this participant — overrides
    // win over the best-submission aggregate, even for problems they
    // never submitted to.
    const overrideRows = await scoreOverrideRepo.findAllByContext("contest", contest.id);
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

    await contestParticipationRepo.update(participation.id, {
      score: totalScore,
      subtaskScores,
    });

    await scoreboard.updateScoreboard(contest.id, participation.id, totalScore);
  }
}

export async function getScoreboard(
  contestId: string,
  options?: { unfrozen?: boolean; isPrivileged?: boolean },
): Promise<ScoreboardData> {
  const contest = await contestRepo.findForScoreboardById(contestId);

  if (!contest || contest.visibility === "draft") {
    throw new NotFoundError("Contest not found.");
  }

  const now = new Date();
  const scoreboardMode = contest.scoreboardMode as ScoreboardMode;
  const showFrozen =
    !options?.unfrozen &&
    (scoreboardMode === "frozen" ||
      (contest.frozenBoard && contest.frozenAt != null && now > contest.frozenAt));

  const problems: ScoreboardProblem[] = contest.problems.map((cp) => ({
    id: cp.problemId,
    ordinal: cp.ordinal,
    points: cp.points,
    title: cp.problem.title,
  }));

  const scoringMode = contest.scoringMode as ContestScoringMode;

  // When scoreboardMode is "hidden", only privileged users can see entries
  if (scoreboardMode === "hidden" && !options?.isPrivileged) {
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

  // Fetch all non-sample submissions for this contest
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

export async function getScoreboardChart(contestId: string, topN: number): Promise<ChartData> {
  // Get the scoreboard to determine top N
  const scoreboardData = await getScoreboard(contestId, { unfrozen: false });

  const topEntries = scoreboardData.entries.slice(0, topN);
  if (topEntries.length === 0) {
    return { series: [] };
  }

  const topUserIds = new Set(topEntries.map((e) => e.userId));

  // Reuse problem points from scoreboard instead of re-fetching contest
  const pointsMap = new Map(scoreboardData.problems.map((p) => [p.id, p.points]));

  // Fetch only startsAt and participations for top users
  const contest = await contestRepo.findForChartById(contestId, [...topUserIds]);

  if (!contest) return { series: [] };

  const participationUserMap = new Map(contest.participations.map((p) => [p.id, p.userId]));

  const participationIds = contest.participations.map((p) => p.id);
  const submissions = await submissionRepo.findForContestChart(participationIds);

  // Keep the pure builder unaware of contestParticipationId plumbing.
  const submissionsByUser = new Map<string, SubmissionRow[]>();
  for (const sub of submissions) {
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
