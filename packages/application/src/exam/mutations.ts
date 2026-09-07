import { assertLateSubmissionPolicy } from "../shared/late-submission-policy";
import { saveActivityGrading } from "../scoring/activity-grading";
import { assertActivityAllocation } from "../scoring/activity-points";
import { examRepo, runTransaction, type Prisma, type TransactionClient } from "@nojv/db";
import { adjustmentRulesSchema, type ExamCreate, type ExamUpdate } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { NotFoundError, ValidationError } from "../shared/errors";
import { lockCourseForStaffMutation } from "../course/problem-library";
import { requireUser } from "../shared/require";
import { stripUndefined } from "../shared/strip-undefined";
import { getDomainOrchestration } from "../shared/orchestration";
import { enforceSubmitCooldown } from "../shared/submit-cooldown";
import { assertEffectiveTimeWindow } from "../shared/effective-time-window";
import { examAutoCloseInput } from "../shared/lifecycle-input";
import { enqueueLifecycleCancellation } from "../shared/lifecycle-cancellation";

export type { ActorContext };

async function requireExam(tx: TransactionClient, examId: string) {
  const exam = await examRepo.withTx(tx).findById(examId);
  if (!exam) {
    throw new NotFoundError(`Exam not found: ${examId}`);
  }
  return exam;
}

export async function checkExamSubmitCooldown(
  tx: TransactionClient,
  examId: string,
  userId: string,
  problemId: string,
  cooldownSec: number,
  now: Date = new Date(),
) {
  await enforceSubmitCooldown(tx, { examId }, userId, problemId, cooldownSec, now);
}

export async function createExamRecord(actor: ActorContext, payload: ExamCreate) {
  const exam = await runTransaction(async (tx) => {
    await requireUser(tx, actor.userId);
    const course = await lockCourseForStaffMutation(tx, actor, payload.courseId);

    const dueAt = payload.dueAt ? new Date(payload.dueAt) : null;
    const endsAt = new Date(payload.endsAt);
    assertEffectiveTimeWindow({
      start: new Date(payload.startsAt),
      due: dueAt,
      end: endsAt,
      fields: { start: "startsAt", due: "dueAt", end: "endsAt" },
    });
    assertLateSubmissionPolicy(payload.adjustmentRules, dueAt, endsAt, payload.scoringMode);
    const created = await examRepo.withTx(tx).create({
      allowedLanguages: payload.allowedLanguages,
      courseId: course.id,
      createdByUserId: actor.userId,
      endsAt,
      dueAt,
      ...(payload.adjustmentRules ? { adjustmentRules: payload.adjustmentRules } : {}),
      ipBindingEnabled: payload.ipBindingEnabled,
      ipViolationMode: payload.ipViolationMode,
      ipWhitelist: payload.ipWhitelist,
      ipWhitelistEnabled: payload.ipWhitelistEnabled,
      pageLockEnabled: payload.pageLockEnabled,
      scoreboardMode: payload.scoreboardMode,
      scoringMode: payload.scoringMode,
      startsAt: new Date(payload.startsAt),
      status: payload.status,
      submitCooldownSec: payload.submitCooldownSec,
      summary: payload.summary ?? "",
      title: payload.title,
    });

    const grading = await saveActivityGrading(tx, actor, {
      type: "exam",
      id: created.id,
      totalPoints: payload.totalPoints,
      problems: payload.problems,
      published: payload.status === "published",
      allowedLanguages: payload.allowedLanguages,
    });

    return { ...created, ...grading };
  });

  if (exam.status === "published") {
    await getDomainOrchestration().ensureExamAutoClose(examAutoCloseInput(exam));
  }

  return exam;
}

export async function updateExamRecord(
  actor: ActorContext,
  examId: string,
  payload: ExamUpdate,
) {
  const result = await runTransaction(async (tx) => {
    const exam = await requireManagedExam(tx, actor, examId);

    const updateData: Prisma.ExamUncheckedUpdateInput = stripUndefined({
      title: payload.title,
      summary: payload.summary,
      scoringMode: payload.scoringMode,
      submitCooldownSec: payload.submitCooldownSec,
      allowedLanguages: payload.allowedLanguages,
      ipWhitelistEnabled: payload.ipWhitelistEnabled,
      ipBindingEnabled: payload.ipBindingEnabled,
      ipWhitelist: payload.ipWhitelist,
      ipViolationMode: payload.ipViolationMode,
      pageLockEnabled: payload.pageLockEnabled,
      scoreboardMode: payload.scoreboardMode,
    });

    const effectiveStartsAt =
      payload.startsAt === undefined ? exam.startsAt : new Date(payload.startsAt);
    const effectiveEndsAt =
      payload.endsAt === undefined ? exam.endsAt : new Date(payload.endsAt);
    const effectiveDueAt =
      payload.dueAt === undefined ? exam.dueAt : payload.dueAt ? new Date(payload.dueAt) : null;
    const currentRules = adjustmentRulesSchema.parse(exam.adjustmentRules ?? []);
    const effectiveRules = adjustmentRulesSchema.parse(payload.adjustmentRules ?? currentRules);
    assertLateSubmissionPolicy(
      effectiveRules,
      effectiveDueAt,
      effectiveEndsAt,
      payload.scoringMode ?? exam.scoringMode,
    );
    const now = new Date();
    const policyChanged =
      (effectiveDueAt ?? effectiveEndsAt).getTime() !== (exam.dueAt ?? exam.endsAt).getTime() ||
      JSON.stringify(effectiveRules) !== JSON.stringify(currentRules);
    if (exam.status === "published" && now >= exam.startsAt) {
      if (
        now >= exam.endsAt &&
        (policyChanged || effectiveEndsAt.getTime() !== exam.endsAt.getTime())
      ) {
        throw new ValidationError("Ended exam deadlines and penalties are read-only.");
      }
      if (
        effectiveStartsAt.getTime() !== exam.startsAt.getTime() ||
        effectiveEndsAt < exam.endsAt
      ) {
        throw new ValidationError("Running exams may only extend their final collection time.");
      }
      const currentDue = exam.dueAt ?? exam.endsAt;
      if ((effectiveDueAt ?? effectiveEndsAt) < currentDue) {
        throw new ValidationError("dueAt can only be extended, not moved earlier.");
      }
      if (JSON.stringify(effectiveRules) !== JSON.stringify(currentRules)) {
        throw new ValidationError(
          "Late penalties cannot be changed once the exam has started.",
        );
      }
      if (payload.scoringMode !== undefined && payload.scoringMode !== exam.scoringMode) {
        throw new ValidationError("scoringMode cannot be changed once the exam has started.");
      }
    }
    if (payload.dueAt !== undefined) updateData.dueAt = effectiveDueAt;
    if (payload.adjustmentRules !== undefined)
      updateData.adjustmentRules = payload.adjustmentRules;
    const windowChanged =
      effectiveStartsAt.getTime() !== exam.startsAt.getTime() ||
      effectiveEndsAt.getTime() !== exam.endsAt.getTime();
    if (effectiveStartsAt.getTime() !== exam.startsAt.getTime()) {
      updateData.startsAt = effectiveStartsAt;
    }
    if (effectiveEndsAt.getTime() !== exam.endsAt.getTime()) {
      updateData.endsAt = effectiveEndsAt;
    }
    assertEffectiveTimeWindow({
      start: effectiveStartsAt,
      end: effectiveEndsAt,
      due: effectiveDueAt,
      fields: { start: "startsAt", due: "dueAt", end: "endsAt" },
    });

    const persisted =
      Object.keys(updateData).length > 0
        ? await examRepo.withTx(tx).update(exam.id, updateData)
        : exam;

    if (payload.problems !== undefined || payload.totalPoints !== undefined) {
      const links = await tx.examProblem.findMany({
        where: { examId: exam.id },
        orderBy: { ordinal: "asc" },
      });
      if (payload.gradingRevision === undefined)
        throw new ValidationError("Grading revision is required.");
      await saveActivityGrading(tx, actor, {
        type: "exam",
        id: exam.id,
        totalPoints: payload.totalPoints ?? Number(exam.totalPoints),
        problems:
          payload.problems ??
          links.map((p) => ({ problemId: p.problemId, points: Number(p.points) })),
        published: exam.status === "published",
        allowedLanguages: payload.allowedLanguages ?? exam.allowedLanguages,
        expectedRevision: payload.gradingRevision,
      });
    }

    return {
      exam: persisted,
      windowChanged,
    };
  });

  if (result.exam.status === "published" && result.windowChanged) {
    await getDomainOrchestration().replaceExamAutoClose(examAutoCloseInput(result.exam));
  }

  return { id: result.exam.id };
}

async function requireManagedExam(tx: TransactionClient, actor: ActorContext, examId: string) {
  const scope = await tx.exam.findUnique({ where: { id: examId }, select: { courseId: true } });
  if (!scope) throw new NotFoundError(`Exam not found: ${examId}`);
  await lockCourseForStaffMutation(tx, actor, scope.courseId);
  await examRepo.withTx(tx).lockForUpdate(examId);
  return requireExam(tx, examId);
}

export async function publishExam(actor: ActorContext, examId: string): Promise<void> {
  const published = await runTransaction(async (tx) => {
    const exam = await requireManagedExam(tx, actor, examId);

    if (exam.status !== "draft") {
      throw new ValidationError("Only draft exams can be published.");
    }

    const attached = await tx.examProblem.findMany({ where: { examId: exam.id } });
    const problemCount = attached.length;
    assertActivityAllocation(
      Number(exam.totalPoints),
      attached.map((p) => ({ problemId: p.problemId, points: Number(p.points) })),
      true,
    );

    if (problemCount === 0) {
      throw new ValidationError("Add at least one problem before publishing.");
    }
    if (exam.allowedLanguages.length === 0) {
      throw new ValidationError("Select at least one allowed language before publishing.");
    }
    assertEffectiveTimeWindow({
      start: exam.startsAt,
      end: exam.endsAt,
      due: exam.dueAt,
      fields: { start: "startsAt", due: "dueAt", end: "endsAt" },
    });
    assertLateSubmissionPolicy(exam.adjustmentRules, exam.dueAt, exam.endsAt, exam.scoringMode);
    if (exam.endsAt <= new Date()) {
      throw new ValidationError("End time must be in the future.");
    }

    return examRepo.withTx(tx).update(exam.id, { status: "published" });
  });

  await getDomainOrchestration().ensureExamAutoClose(examAutoCloseInput(published));
}

export async function deleteExamDraft(actor: ActorContext, examId: string): Promise<void> {
  await runTransaction(async (tx) => {
    const exam = await requireManagedExam(tx, actor, examId);

    if (exam.status !== "draft") {
      throw new ValidationError("Only draft exams can be deleted.");
    }

    await enqueueLifecycleCancellation(tx, {
      type: "exam",
      input: examAutoCloseInput(exam),
    });
    await examRepo.withTx(tx).delete(exam.id);
  });
}
