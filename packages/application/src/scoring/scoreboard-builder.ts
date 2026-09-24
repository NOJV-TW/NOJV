import { buildProblemCountScoreboard } from "./problem-count";
import { buildPointSumScoreboard, type ScoreOverrideRow } from "./point-sum";
import {
  secondsSince,
  type ParticipantRow,
  type ScoreboardEntry,
  type ScoreboardProblem,
  type SubmissionRow,
  type TimedSession,
} from "./rank-util";

type ScoringMode = "problem_count" | "weighted_count" | (string & {});

function isSolveCountMode(scoringMode: ScoringMode): boolean {
  return scoringMode === "problem_count" || scoringMode === "weighted_count";
}

export function buildScoreboard(
  session: TimedSession,
  scoringMode: ScoringMode,
  participants: ParticipantRow[],
  submissions: SubmissionRow[],
  problems: ScoreboardProblem[],
  showFrozen: boolean,
  overrides: readonly ScoreOverrideRow[] = [],
): ScoreboardEntry[] {
  return isSolveCountMode(scoringMode)
    ? buildProblemCountScoreboard(
        session,
        participants,
        submissions,
        problems,
        showFrozen,
        scoringMode === "weighted_count",
      )
    : buildPointSumScoreboard(
        session,
        participants,
        submissions,
        problems,
        showFrozen,
        overrides,
      );
}

export interface ChartSeriesPoint {
  time: number;
  score: number;
}

export interface ChartSeries {
  userId: string;
  username: string;
  points: ChartSeriesPoint[];
}

export function buildScoreboardChartSeries(
  sessionStartsAt: Date,
  scoringMode: ScoringMode,
  topUserIds: readonly string[],
  submissionsByUser: Map<string, SubmissionRow[]>,
  usernameByUser: Map<string, string>,
  pointsByProblem: Map<string, number>,
): ChartSeries[] {
  return topUserIds.map((userId) => {
    const userSubs = submissionsByUser.get(userId) ?? [];
    const points: ChartSeriesPoint[] = [{ time: 0, score: 0 }];

    if (isSolveCountMode(scoringMode)) {
      const usePoints = scoringMode === "weighted_count";
      const solved = new Set<string>();
      let cumScore = 0;

      for (const sub of userSubs) {
        if (sub.status === "accepted" && !solved.has(sub.problemId)) {
          solved.add(sub.problemId);
          cumScore += usePoints ? (pointsByProblem.get(sub.problemId) ?? 0) : 1;
          points.push({
            score: cumScore,
            time: secondsSince(sessionStartsAt, sub.createdAt),
          });
        }
      }
    } else {
      const bestByProblem = new Map<string, number>();
      let cumScore = 0;

      for (const sub of userSubs) {
        const current = bestByProblem.get(sub.problemId) ?? 0;
        if (sub.score > current) {
          cumScore += sub.score - current;
          bestByProblem.set(sub.problemId, sub.score);
          points.push({
            score: cumScore,
            time: secondsSince(sessionStartsAt, sub.createdAt),
          });
        }
      }
    }

    return {
      username: usernameByUser.get(userId) ?? userId,
      points,
      userId,
    };
  });
}
