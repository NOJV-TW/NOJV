import { scoreOverrideRepo, submissionRepo } from "@nojv/db";

import {
  toContextDbFields,
  type ScoreOverrideContext,
  type ScoreOverrideContextType,
} from "../score-override/types";

export type ResolvedScoreContext = ScoreOverrideContext;

export interface ResolvedScore {
  score: number;
  source: "override" | "submission";
}

/**
 * Single gateway used by every scoreboard / stats / matrix reader to
 * determine the "final" score for a given (user, problem, context). If
 * a `ScoreOverride` row exists, it wins — otherwise the caller falls
 * back to the best submission score.
 *
 * Practice context is not a valid override target (the
 * `ScoreOverrideContext` union makes it unrepresentable), so practice
 * callers should NOT funnel through this helper.
 */
export async function resolveFinalScore(
  userId: string,
  problemId: string,
  context: ResolvedScoreContext,
): Promise<ResolvedScore> {
  const db = toContextDbFields(context);
  const override = await scoreOverrideRepo.findUnique({
    userId,
    problemId,
    contextType: db.contextType,
    contextId: db.contextId,
  });
  if (override) {
    return { score: override.overrideScore, source: "override" };
  }

  // Fall back to the best submission score for this (user, problem, context).
  const whereByType: Record<ScoreOverrideContextType, Record<string, unknown>> = {
    assignment: { courseAssessmentId: db.contextId },
    exam: { examId: db.contextId },
    contest: { contestId: db.contextId },
  };
  const grouped = await submissionRepo.groupByUserAndProblem({
    userId,
    problemId,
    sampleOnly: false,
    ...whereByType[context.type],
  });
  const best = grouped[0]?._max.score ?? 0;
  return { score: best, source: "submission" };
}

/**
 * Bulk variant — fetches every override row for a given context in a
 * single query and returns a lookup map keyed by `${userId}::${problemId}`.
 * Readers that already have best-score data in a Map (e.g.
 * submissions-matrix builders) can overlay this map without adding a
 * per-cell round trip.
 */
export async function resolveOverridesForContext(
  context: ResolvedScoreContext,
): Promise<Map<string, number>> {
  const db = toContextDbFields(context);
  const rows = await scoreOverrideRepo.findAllByContext(db.contextType, db.contextId);
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(`${row.userId}::${row.problemId}`, row.overrideScore);
  }
  return map;
}
