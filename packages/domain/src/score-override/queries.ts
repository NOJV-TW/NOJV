import { scoreOverrideAuditLogRepo, scoreOverrideRepo } from "@nojv/db";

import { toContextDbFields, type ScoreOverrideContext } from "./types";

export async function listByContext(context: ScoreOverrideContext) {
  const db = toContextDbFields(context);
  return scoreOverrideRepo.listByContext(db.contextType, db.contextId);
}

export async function listAuditForContext(context: ScoreOverrideContext, limit = 100) {
  const db = toContextDbFields(context);
  return scoreOverrideAuditLogRepo.listForContext(db.contextType, db.contextId, limit);
}
