import { scoreOverrideRepo } from "@nojv/db";

import { toContextDbFields, type ScoreOverrideContext } from "./types";

export async function listByContext(context: ScoreOverrideContext) {
  const db = toContextDbFields(context);
  return scoreOverrideRepo.listByContext(db.contextType, db.contextId);
}
