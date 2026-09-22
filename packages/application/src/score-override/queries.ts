import { scoreOverrideRepo } from "@nojv/db";

import { toContextDbFields, type ScoreOverrideContext } from "./types";

export async function listByContext(context: ScoreOverrideContext) {
  return scoreOverrideRepo.listByContext(toContextDbFields(context));
}
