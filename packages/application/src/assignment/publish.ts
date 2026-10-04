import { assessmentAuditLogRepo, assessmentRepo, type TransactionClient } from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { assertActivityAllocation } from "../scoring/activity-points";
import { assertEffectiveTimeWindow } from "../shared/effective-time-window";
import { ValidationError } from "../shared/errors";
import { assertLateSubmissionPolicy } from "../shared/late-submission-policy";

interface DraftAssignment {
  id: string;
  courseId: string;
  status: string;
  allowedLanguages: readonly string[];
  opensAt: Date;
  dueAt: Date | null;
  closesAt: Date;
  adjustmentRules: unknown;
}

export async function publishAssignmentInTransaction(
  tx: TransactionClient,
  actor: ActorContext,
  assignment: DraftAssignment,
) {
  if (assignment.status !== "draft") {
    throw new ValidationError("Only draft assignments can be published.");
  }

  if (assignment.allowedLanguages.length < 1) {
    throw new ValidationError("Select at least one allowed language before publishing.");
  }

  const attached = await tx.assessmentProblem.findMany({
    where: { assessmentId: assignment.id },
  });
  if (attached.length < 1) {
    throw new ValidationError("Attach at least one problem before publishing.");
  }
  assertActivityAllocation(
    attached.map((p) => ({ problemId: p.problemId, points: Number(p.points) })),
    true,
  );

  const now = new Date();
  if (assignment.closesAt <= now) {
    throw new ValidationError("closesAt must be in the future.");
  }
  assertEffectiveTimeWindow({
    start: assignment.opensAt,
    due: assignment.dueAt,
    end: assignment.closesAt,
    fields: { start: "opensAt", due: "dueAt", end: "closesAt" },
  });

  assertLateSubmissionPolicy(assignment.adjustmentRules, assignment.dueAt, assignment.closesAt);
  const persisted = await assessmentRepo.withTx(tx).update(assignment.id, {
    status: "published",
  });
  await assessmentAuditLogRepo.withTx(tx).create({
    assessmentId: assignment.id,
    courseId: assignment.courseId,
    actorUserId: actor.userId,
    action: "publish",
  });

  return persisted;
}
