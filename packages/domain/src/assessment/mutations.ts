import {
  assessmentProblemRepo,
  assessmentRepo,
  courseMembershipRepo,
  problemRepo,
  runTransaction,
  type Prisma,
  type TransactionClient
} from "@nojv/db";
import type { CourseAssessmentUpdate, Language } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError, ValidationError } from "../shared/errors";
import { canManageCourse, resolveEffectiveCourseRole } from "../shared/permissions";
import { assertProblemHasWorkspaceForLanguages } from "../problem/helpers";
import { stripUndefined } from "../shared/strip-undefined";

async function requireAssessment(tx: TransactionClient, assessmentId: string) {
  const assessment = await assessmentRepo.withTx(tx).findById(assessmentId);
  if (!assessment) {
    throw new NotFoundError(`Assignment not found: ${assessmentId}`);
  }
  return assessment;
}

// Defensive re-check — callers SHOULD have already verified this at the
// route boundary, but mutations are not allowed to trust loader state.
async function assertAssessmentManager(
  tx: TransactionClient,
  actor: ActorContext,
  assessment: { courseId: string; createdByUserId: string }
) {
  if (actor.platformRole === "admin") return;
  if (assessment.createdByUserId === actor.userId) return;

  const membership = await courseMembershipRepo
    .withTx(tx)
    .findByComposite(assessment.courseId, actor.userId);
  const effectiveRole = resolveEffectiveCourseRole(
    actor.platformRole,
    membership?.role ?? null
  );
  if (!canManageCourse(effectiveRole) || membership?.status !== "active") {
    throw new ForbiddenError("You do not have permission to edit this assignment.");
  }
}

type AssessmentLiveStatus = "draft" | "upcoming" | "open" | "closed" | "archived";

function deriveLiveStatus(
  row: { status: string; opensAt: Date; closesAt: Date },
  now: Date
): AssessmentLiveStatus {
  if (row.status === "archived") return "archived";
  if (row.status === "draft") return "draft";
  if (row.opensAt > now) return "upcoming";
  if (row.closesAt < now) return "closed";
  return "open";
}

// Status-aware field-level lock. Once the assignment is open, we freeze
// `opensAt` (already happened) and only allow `dueAt` / `closesAt` to
// move forward — never backward. Closed / archived assignments are fully
// immutable via this path; the archive toggle uses a dedicated entry.
function assertFieldsAllowedForStatus(
  liveStatus: AssessmentLiveStatus,
  current: { opensAt: Date; dueAt: Date | null; closesAt: Date },
  payload: CourseAssessmentUpdate
): void {
  if (liveStatus === "closed") {
    throw new ValidationError("Closed assignments can only be archived.");
  }
  if (liveStatus === "archived") {
    throw new ValidationError("Archived assignments can only be unarchived.");
  }

  if (liveStatus === "draft" || liveStatus === "upcoming") return;

  // liveStatus === "open": opensAt frozen, dueAt/closesAt delay-only.
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

async function replaceAssessmentProblems(
  tx: TransactionClient,
  assessmentId: string,
  problemIds: string[],
  allowedLanguages: Language[],
  pointsByProblem: Map<string, number>
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
      problemIds.map((id) => assertProblemHasWorkspaceForLanguages(tx, id, allowedLanguages))
    );
  }

  await assessmentProblemRepo.withTx(tx).deleteByAssessmentId(assessmentId);

  await Promise.all(
    problemIds.map(async (id, index) => {
      await assessmentProblemRepo.withTx(tx).create({
        assessmentId,
        ordinal: index + 1,
        points: pointsByProblem.get(id) ?? 100,
        problemId: id
      });
    })
  );
}

/**
 * Partial update of a course assessment. Mirrors `updateExamRecord` in the
 * exam domain: permission check, strip `undefined`, coerce date strings,
 * and if `problemIds` is provided, wipe-and-recreate the attach rows.
 * Emits status-aware field-lock violations as `ValidationError` (400).
 */
export async function updateAssessmentRecord(
  actor: ActorContext,
  assessmentId: string,
  payload: CourseAssessmentUpdate
): Promise<{ id: string }> {
  return runTransaction(async (tx) => {
    const assessment = await requireAssessment(tx, assessmentId);
    await assertAssessmentManager(tx, actor, assessment);

    const liveStatus = deriveLiveStatus(assessment, new Date());
    assertFieldsAllowedForStatus(
      liveStatus,
      {
        opensAt: assessment.opensAt,
        dueAt: assessment.dueAt,
        closesAt: assessment.closesAt
      },
      payload
    );

    const updateData: Prisma.CourseAssessmentUncheckedUpdateInput = stripUndefined({
      title: payload.title,
      summary: payload.summary,
      allowedLanguages: payload.allowedLanguages,
      maxAttemptsPerDay: payload.maxAttemptsPerDay
    });

    if (payload.opensAt !== undefined) updateData.opensAt = new Date(payload.opensAt);
    if (payload.closesAt !== undefined) updateData.closesAt = new Date(payload.closesAt);
    if (payload.dueAt !== undefined) {
      updateData.dueAt = payload.dueAt ? new Date(payload.dueAt) : null;
    }

    if (Object.keys(updateData).length > 0) {
      await assessmentRepo.withTx(tx).update(assessment.id, updateData);
    }

    if (payload.problemIds !== undefined) {
      const enforcedLanguages =
        payload.allowedLanguages ?? (assessment.allowedLanguages as Language[]);
      const pointsByProblem = new Map<string, number>();
      for (const row of payload.problemOrdinals ?? []) {
        pointsByProblem.set(row.problemId, row.points);
      }
      await replaceAssessmentProblems(
        tx,
        assessment.id,
        payload.problemIds,
        enforcedLanguages,
        pointsByProblem
      );
    }

    return { id: assessment.id };
  });
}

/**
 * Publish a draft assessment. Enforces the invariants a draft can skirt:
 * at least one problem, at least one allowed language, sane time window,
 * and the close time must still be in the future.
 */
export async function publishAssessment(
  actor: ActorContext,
  assessmentId: string
): Promise<void> {
  await runTransaction(async (tx) => {
    const assessment = await requireAssessment(tx, assessmentId);
    await assertAssessmentManager(tx, actor, assessment);

    if (assessment.status !== "draft") {
      throw new ValidationError("Only draft assignments can be published.");
    }

    const allowedLanguages = assessment.allowedLanguages as Language[];
    if (allowedLanguages.length < 1) {
      throw new ValidationError("Select at least one allowed language before publishing.");
    }

    const attached = await assessmentProblemRepo.findByAssessmentId(assessment.id);
    if (attached.length < 1) {
      throw new ValidationError("Attach at least one problem before publishing.");
    }

    const now = new Date();
    if (assessment.closesAt <= now) {
      throw new ValidationError("closesAt must be in the future.");
    }
    if (!(assessment.opensAt < assessment.closesAt)) {
      throw new ValidationError("closesAt must be later than opensAt.");
    }
    if (assessment.dueAt) {
      if (!(assessment.opensAt < assessment.dueAt)) {
        throw new ValidationError("dueAt must be later than opensAt.");
      }
      if (!(assessment.dueAt <= assessment.closesAt)) {
        throw new ValidationError("closesAt must be later than or equal to dueAt.");
      }
    }

    await assessmentRepo.withTx(tx).update(assessment.id, { status: "published" });
  });
}

/**
 * Delete a draft assessment. Non-draft states must go through archive
 * (reversible) — delete is reserved for drafts that never shipped.
 */
export async function deleteAssessmentDraft(
  actor: ActorContext,
  assessmentId: string
): Promise<void> {
  await runTransaction(async (tx) => {
    const assessment = await requireAssessment(tx, assessmentId);
    await assertAssessmentManager(tx, actor, assessment);

    if (assessment.status !== "draft") {
      throw new ValidationError("Only draft assignments can be deleted.");
    }

    await assessmentRepo.withTx(tx).delete(assessment.id);
  });
}

/**
 * Archive a published assessment — hides it from student lists while
 * preserving submission history. Reversible via `unarchiveAssessment`.
 */
export async function archiveAssessment(
  actor: ActorContext,
  assessmentId: string
): Promise<void> {
  await runTransaction(async (tx) => {
    const assessment = await requireAssessment(tx, assessmentId);
    await assertAssessmentManager(tx, actor, assessment);

    if (assessment.status !== "published") {
      throw new ValidationError("Only published assignments can be archived.");
    }

    await assessmentRepo.withTx(tx).update(assessment.id, { status: "archived" });
  });
}

/** Reverse of `archiveAssessment`. Returns the row to `published`. */
export async function unarchiveAssessment(
  actor: ActorContext,
  assessmentId: string
): Promise<void> {
  await runTransaction(async (tx) => {
    const assessment = await requireAssessment(tx, assessmentId);
    await assertAssessmentManager(tx, actor, assessment);

    if (assessment.status !== "archived") {
      throw new ValidationError("Only archived assignments can be unarchived.");
    }

    await assessmentRepo.withTx(tx).update(assessment.id, { status: "published" });
  });
}

/** Flip status back to draft — only valid from `upcoming`. */
export async function revertAssessmentToDraft(
  actor: ActorContext,
  assessmentId: string
): Promise<void> {
  await runTransaction(async (tx) => {
    const assessment = await requireAssessment(tx, assessmentId);
    await assertAssessmentManager(tx, actor, assessment);

    if (assessment.status !== "published") {
      throw new ValidationError("Only published assignments can be reverted to draft.");
    }
    if (assessment.opensAt <= new Date()) {
      throw new ValidationError("Cannot revert an assignment that has already opened.");
    }

    await assessmentRepo.withTx(tx).update(assessment.id, { status: "draft" });
  });
}
