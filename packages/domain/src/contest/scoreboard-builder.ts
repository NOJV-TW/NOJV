import { contestRepo, submissionRepo } from "@nojv/db";
import type { ContestScoringMode, ScoreboardMode } from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { buildIcpcScoreboard } from "./icpc-scoring";
import { buildIoiScoreboard } from "./ioi-scoring";
import {
  secondsSince,
  type ParticipantRow,
  type ScoreboardEntry,
  type ScoreboardProblem,
  type SubmissionRow
} from "./rank-util";

export type { ProblemScore, ScoreboardEntry, ScoreboardProblem } from "./rank-util";

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

export async function getScoreboard(
  contestSlug: string,
  options?: { unfrozen?: boolean; isPrivileged?: boolean }
): Promise<ScoreboardData> {
  const contest = await contestRepo.findForScoreboard(contestSlug);

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
    title: cp.problem.title
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
      scoringMode
    };
  }

  if (contest.participations.length === 0) {
    return {
      entries: [],
      frozenAt: contest.frozenAt?.toISOString() ?? null,
      isFrozen: showFrozen,
      problems,
      scoreboardMode,
      scoringMode
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
    userId: s.contestParticipation?.userId ?? ""
  }));

  const participants: ParticipantRow[] = contest.participations;

  const entries =
    scoringMode === "problem_count"
      ? buildIcpcScoreboard(contest, participants, submissions, problems, showFrozen)
      : buildIoiScoreboard(contest, participants, submissions, problems, showFrozen);

  return {
    entries,
    frozenAt: contest.frozenAt?.toISOString() ?? null,
    isFrozen: showFrozen,
    problems,
    scoreboardMode,
    scoringMode
  };
}

export async function getScoreboardChart(
  contestSlug: string,
  topN: number
): Promise<ChartData> {
  // Get the scoreboard to determine top N
  const scoreboardData = await getScoreboard(contestSlug, { unfrozen: false });

  const topEntries = scoreboardData.entries.slice(0, topN);
  if (topEntries.length === 0) {
    return { series: [] };
  }

  const topUserIds = new Set(topEntries.map((e) => e.userId));

  // Reuse problem points from scoreboard instead of re-fetching contest
  const pointsMap = new Map(scoreboardData.problems.map((p) => [p.id, p.points]));

  // Fetch only startsAt and participations for top users
  const contest = await contestRepo.findForChart(contestSlug, [...topUserIds]);

  if (!contest) return { series: [] };

  const participationIds = contest.participations.map((p) => p.id);
  const participationUserMap = new Map(contest.participations.map((p) => [p.id, p.userId]));

  const submissions = await submissionRepo.findForContestChart(participationIds);

  const scoringMode = scoreboardData.scoringMode;
  const usernameMap = new Map(topEntries.map((e) => [e.userId, e.username]));

  const series = [...topUserIds].map((userId) => {
    const userSubs = submissions.filter(
      (s) => participationUserMap.get(s.contestParticipationId ?? "") === userId
    );

    const points: { time: number; score: number }[] = [{ time: 0, score: 0 }];

    if (scoringMode === "problem_count") {
      // Track cumulative solved * points
      const solved = new Set<string>();
      let cumScore = 0;

      for (const sub of userSubs) {
        if (sub.status === "accepted" && !solved.has(sub.problemId)) {
          solved.add(sub.problemId);
          cumScore += pointsMap.get(sub.problemId) ?? 0;
          points.push({
            score: cumScore,
            time: secondsSince(contest.startsAt, sub.createdAt)
          });
        }
      }
    } else {
      // IOI: track cumulative best scores
      const bestByProblem = new Map<string, number>();
      let cumScore = 0;

      for (const sub of userSubs) {
        const current = bestByProblem.get(sub.problemId) ?? 0;
        if (sub.score > current) {
          cumScore += sub.score - current;
          bestByProblem.set(sub.problemId, sub.score);
          points.push({
            score: cumScore,
            time: secondsSince(contest.startsAt, sub.createdAt)
          });
        }
      }
    }

    return {
      username: usernameMap.get(userId) ?? userId,
      points,
      userId
    };
  });

  return { series };
}
