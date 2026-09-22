import { scoreOverrideRepo } from "@nojv/db";

import { toContextDbFields, type ScoreOverrideContext } from "../score-override/types";

export async function getOverridesForContext(
  context: ScoreOverrideContext,
): Promise<Map<string, number>> {
  const rows = await scoreOverrideRepo.findAllByContext(toContextDbFields(context));
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(`${row.courseMembershipId}::${row.problemId}`, row.overrideScore);
  }
  return map;
}
