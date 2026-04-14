import { buildIcpcScoreboard } from "./icpc";
import { buildIoiScoreboard } from "./ioi";
import {
  secondsSince,
  type ParticipantRow,
  type ScoreboardEntry,
  type ScoreboardProblem,
  type SubmissionRow,
  type TimedSession
} from "./rank-util";

/**
 * Scoring mode accepted by the shared builder. "problem_count" runs ICPC
 * rules; anything else runs IOI rules. Consumers pass their own string
 * enum value through unchanged.
 */
export type ScoringMode = "problem_count" | (string & {});

/**
 * Pure scoreboard builder: dispatches to ICPC or IOI based on `scoringMode`
 * and returns ranked entries. Takes all inputs as plain values so both
 * Contest and Exam orchestrators can call it with their own fetched data.
 */
export function buildScoreboard(
  session: TimedSession,
  scoringMode: ScoringMode,
  participants: ParticipantRow[],
  submissions: SubmissionRow[],
  problems: ScoreboardProblem[],
  showFrozen: boolean
): ScoreboardEntry[] {
  return scoringMode === "problem_count"
    ? buildIcpcScoreboard(session, participants, submissions, problems, showFrozen)
    : buildIoiScoreboard(session, participants, submissions, problems, showFrozen);
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

/**
 * Pure chart-series builder: given a session start, scoring mode, and the
 * already-grouped user→submissions map, produce cumulative score-over-time
 * traces for each top user. Consumers decide how to fetch the top user IDs
 * and how to resolve display usernames; this function only transforms.
 */
export function buildScoreboardChartSeries(
  sessionStartsAt: Date,
  scoringMode: ScoringMode,
  topUserIds: readonly string[],
  submissionsByUser: Map<string, SubmissionRow[]>,
  usernameByUser: Map<string, string>,
  pointsByProblem: Map<string, number>
): ChartSeries[] {
  return topUserIds.map((userId) => {
    const userSubs = submissionsByUser.get(userId) ?? [];
    const points: ChartSeriesPoint[] = [{ time: 0, score: 0 }];

    if (scoringMode === "problem_count") {
      // Track cumulative solved * points
      const solved = new Set<string>();
      let cumScore = 0;

      for (const sub of userSubs) {
        if (sub.status === "accepted" && !solved.has(sub.problemId)) {
          solved.add(sub.problemId);
          cumScore += pointsByProblem.get(sub.problemId) ?? 0;
          points.push({
            score: cumScore,
            time: secondsSince(sessionStartsAt, sub.createdAt)
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
            time: secondsSince(sessionStartsAt, sub.createdAt)
          });
        }
      }
    }

    return {
      username: usernameByUser.get(userId) ?? userId,
      points,
      userId
    };
  });
}
