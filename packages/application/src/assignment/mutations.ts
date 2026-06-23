import {
  assessmentAuditLogRepo,
  assessmentProblemRepo,
  assessmentRepo,
  courseMembershipRepo,
  problemRepo,
  runTransaction,
  type Prisma,
  type TransactionClient,
} from "@nojv/db";
import type { AssessmentUpdate, Language } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError, ValidationError } from "../shared/errors";
import { getDomainOrchestration } from "../shared/orchestration";
import { canManageCourse, resolveEffectiveCourseRole } from "../shared/permissions";
import { assertProblemHasWorkspaceForLanguages } from "../problem/permissions";
import { stripUndefined } from "../shared/strip-undefined";

async function requireAssignment(tx: TransactionClient, assignmentId: string) {
  const assignment = await assessmentRepo.withTx(tx).findById(assignmentId);
  if (!assignment) {
    throw new NotFoundError(`Assignment not found: ${assignmentId}`);
  }
  return assignment;
}

async function assertAssignmentManager(
  tx: TransactionClient,
  actor: ActorContext,
  assignment: { courseId: string; createdByUserId: string },
) {
  if (actor.platformRole === "admin") return;
  if (assignment.createdByUserId === actor.userId) return;

  const membership = await courseMembershipRepo
    .withTx(tx)
    .findByComposite(assignment.courseId, actor.userId);
  const effectiveRole = resolveEffectiveCourseRole(
    actor.platformRole,
    membership?.role ?? null,
  );
  if (!canManageCourse(effectiveRole) || membership?.status !== "active") {
    throw new ForbiddenError("You do not have permission to edit this assignment.");
  }
}

type AssignmentLiveStatus = "draft" | "upcoming" | "open" | "closed";

function deriveLiveStatus(
  row: { status: string; opensAt: Date; closesAt: Date },
  now: Date,
): AssignmentLiveStatus {
  if (row.status === "draft") return "draft";
  if (row.opensAt > now) return "upcoming";
  if (row.closesAt < now) return "closed";
  return "open";
}

function assertFieldsAllowedForStatus(
  liveStatus: AssignmentLiveStatus,
  current: { opensAt: Date; dueAt: Date | null; closesAt: Date },
  payload: AssessmentUpdate,
): void {
  if (liveStatus === "closed") {
    throw new ValidationError("Closed assignments are read-only.");
  }

  if (liveStatus === "draft" || liveStatus === "upcoming") return;

  if (payload.opensAt !== undefined) {
    const nextOpens = new Date(payload.opensAt);
    if (nextOpens.getTime() !== current.opensAt.getTime()) {
      throw new ValidationError("opensAt cannot be changed once the assignment is open.");
    }
  }
  if (payload.closesAt !== undefined) {
    const nextCloses = new Date(payload.closesAt);
    if (nextCloses < current.closesAt) {
      throw new ValidationError("closesAt can only be extended, not moved earlier.");
    }
  }
  if (payload.dueAt !== undefined && payload.dueAt !== null) {
    const nextDue = new Date(payload.dueAt);
    if (current.dueAt && nextDue < current.dueAt) {
      throw new ValidationError("dueAt can only be extended, not moved earlier.");
    }
  }
}

async function replaceAssignmentProblems(
  tx: TransactionClient,
  assignmentId: string,
  problemIds: string[],
  allowedLanguages: Language[],
  pointsByProblem: Map<string, number>,
) {
  const problems =
    problemIds.length === 0
      ? []
      : await problemRepo.withTx(tx).findMany({ id: { in: problemIds } });
  const problemById = new Map(problems.map((p) => [p.id, p]));

  for (const id of problemIds) {
    if (!problemById.has(id)) {
      throw new NotFoundError(`Problem not found: ${id}`);
    }
  }

  if (allowedLanguages.length > 0 && problemIds.length > 0) {
    await Promise.all(
      problemIds.map((id) => assertProblemHasWorkspaceForLanguages(tx, id, allowedLanguages)),
    );
  }

  await assessmentProblemRepo.withTx(tx).deleteByAssessmentId(assignmentId);

  await Promise.all(
    problemIds.map(async (id, index) => {
      await assessmentProblemRepo.withTx(tx).create({
        assessmentId: assignmentId,
        ordinal: index + 1,
        points: pointsByProblem.get(id) ?? 100,
        problemId: id,
      });
    }),
  );
}

export async function updateAssignmentRecord(
  actor: ActorContext,
  assignmentId: string,
  payload: AssessmentUpdate,
): Promise<{ id: string }> {
  const result = await runTransaction(async (tx) => {
    const assignment = await requireAssignment(tx, assignmentId);
    await assertAssignmentManager(tx, actor, assignment);

    const liveStatus = deriveLiveStatus(assignment, new Date());
    assertFieldsAllowedForStatus(
      liveStatus,
      {
        opensAt: assignment.opensAt,
        dueAt: assignment.dueAt,
        closesAt: assignment.closesAt,
      },
      payload,
    );

    const closesChanged =
      payload.closesAt !== undefined &&
      new Date(payload.closesAt).getTime() !== assignment.closesAt.getTime();
    const effectiveClosesAt =
      payload.closesAt !== undefined ? new Date(payload.closesAt) : assignment.closesAt;

    const updateData: Prisma.AssessmentUncheckedUpdateInput = stripUndefined({
      title: payload.title,
      summary: payload.summary,
      allowedLanguages: payload.allowedLanguages,
      maxAttemptsPerDay: payload.maxAttemptsPerDay,
      attemptResetMinuteOfDay: payload.attemptResetMinuteOfDay,
    });

    if (payload.opensAt !== undefined) updateData.opensAt = new Date(payload.opensAt);
    if (payload.closesAt !== undefined) updateData.closesAt = new Date(payload.closesAt);
    if (payload.dueAt !== undefined) {
      updateData.dueAt = payload.dueAt ? new Date(payload.dueAt) : null;
    }
    if (payload.adjustmentRules !== undefined) {
      updateData.adjustmentRules = payload.adjustmentRules;
    }

    if (Object.keys(updateData).length > 0) {
      await assessmentRepo.withTx(tx).update(assignment.id, updateData);
    }

    if (payload.problemIds !== undefined) {
      const enforcedLanguages = payload.allowedLanguages ?? assignment.allowedLanguages;
      const pointsByProblem = new Map<string, number>();
      for (const row of payload.problemOrdinals ?? []) {
        pointsByProblem.set(row.problemId, row.points);
      }
      await replaceAssignmentProblems(
        tx,
        assignment.id,
        payload.problemIds,
        enforcedLanguages,
        pointsByProblem,
      );
    }

    return {
      id: assignment.id,
      status: assignment.status,
      closesChanged,
      closesAt: effectiveClosesAt,
    };
  });

  if (result.status === "published" && result.closesChanged) {
    await getDomainOrchestration().dispatchAssignmentDueSoon({
      assignmentId: result.id,
      closesAt: result.closesAt.toISOString(),
    });
  }

  return { id: result.id };
}

export async function publishAssignment(
  actor: ActorContext,
  assignmentId: string,
): Promise<void> {
  const published = await runTransaction(async (tx) => {
    const assignment = await requireAssignment(tx, assignmentId);
    await assertAssignmentManager(tx, actor, assignment);

    if (assignment.status !== "draft") {
      throw new ValidationError("Only draft assignments can be published.");
    }

    if (assignment.allowedLanguages.length < 1) {
      throw new ValidationError("Select at least one allowed language before publishing.");
    }

    const attached = await assessmentProblemRepo.findByAssessmentId(assignment.id);
    if (attached.length < 1) {
      throw new ValidationError("Attach at least one problem before publishing.");
    }

    const now = new Date();
    if (assignment.closesAt <= now) {
      throw new ValidationError("closesAt must be in the future.");
    }
    if (assignment.opensAt >= assignment.closesAt) {
      throw new ValidationError("closesAt must be later than opensAt.");
    }
    if (assignment.dueAt) {
      if (assignment.opensAt >= assignment.dueAt) {
        throw new ValidationError("dueAt must be later than opensAt.");
      }
      if (assignment.dueAt > assignment.closesAt) {
        throw new ValidationError("closesAt must be later than or equal to dueAt.");
      }
    }

    await assessmentRepo.withTx(tx).update(assignment.id, { status: "published" });
    await assessmentAuditLogRepo.withTx(tx).create({
      assessmentId: assignment.id,
      courseId: assignment.courseId,
      actorUserId: actor.userId,
      action: "publish",
    });

    return { id: assignment.id, closesAt: assignment.closesAt };
  });

  await getDomainOrchestration().dispatchAssignmentDueSoon({
    assignmentId: published.id,
    closesAt: published.closesAt.toISOString(),
  });
}

export async function deleteAssignmentDraft(
  actor: ActorContext,
  assignmentId: string,
): Promise<void> {
  await runTransaction(async (tx) => {
    const assignment = await requireAssignment(tx, assignmentId);
    await assertAssignmentManager(tx, actor, assignment);

    if (assignment.status !== "draft") {
      throw new ValidationError("Only draft assignments can be deleted.");
    }

    await assessmentAuditLogRepo.withTx(tx).create({
      assessmentId: assignment.id,
      courseId: assignment.courseId,
      actorUserId: actor.userId,
      action: "delete_draft",
    });
    await assessmentRepo.withTx(tx).delete(assignment.id);
  });
}

export async function revertAssignmentToDraft(
  actor: ActorContext,
  assignmentId: string,
): Promise<void> {
  await runTransaction(async (tx) => {
    const assignment = await requireAssignment(tx, assignmentId);
    await assertAssignmentManager(tx, actor, assignment);

    if (assignment.status !== "published") {
      throw new ValidationError("Only published assignments can be reverted to draft.");
    }
    if (assignment.opensAt <= new Date()) {
      throw new ValidationError("Cannot revert an assignment that has already opened.");
    }

    await assessmentRepo.withTx(tx).update(assignment.id, { status: "draft" });
    await assessmentAuditLogRepo.withTx(tx).create({
      assessmentId: assignment.id,
      courseId: assignment.courseId,
      actorUserId: actor.userId,
      action: "revert_to_draft",
    });
  });
}
