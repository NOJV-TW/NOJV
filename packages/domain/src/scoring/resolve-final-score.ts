import { scoreOverrideRepo } from "@nojv/db";

import { toContextDbFields, type ScoreOverrideContext } from "../score-override/types";

/**
 * Bulk variant — fetches every override row for a given context in a
 * single query and returns a lookup map keyed by `${userId}::${problemId}`.
 * Readers that already have best-score data in a Map (e.g.
 * submissions-matrix builders) can overlay this map without adding a
 * per-cell round trip.
 */
export async function getOverridesForContext(
  context: ScoreOverrideContext,
): Promise<Map<string, number>> {
  const db = toContextDbFields(context);
  const rows = await scoreOverrideRepo.findAllByContext(db.contextType, db.contextId);
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(`${row.userId}::${row.problemId}`, row.overrideScore);
  }
  return map;
}
