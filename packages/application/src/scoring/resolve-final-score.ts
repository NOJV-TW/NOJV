import { scoreOverrideRepo } from "@nojv/db";

import { toContextDbFields, type ScoreOverrideContext } from "../score-override/types";

export async function getOverridesForContext(
  context: ScoreOverrideContext,
): Promise<Map<string, number>> {
  const db = toContextDbFields(context);
  const rows = await scoreOverrideRepo.findAllByContext(db.contextType, db.contextId);
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.courseMembershipId !== null) {
      map.set(`${row.courseMembershipId}::${row.problemId}`, row.overrideScore);
    }
  }
  return map;
}
