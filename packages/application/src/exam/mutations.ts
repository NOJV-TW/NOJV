import {
  courseRepo,
  examProblemRepo,
  examRepo,
  problemRepo,
  runTransaction,
  type Prisma,
  type TransactionClient,
} from "@nojv/db";
import type { ExamCreate, ExamUpdate, Language } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError, ValidationError } from "../shared/errors";
import { isCourseStaffTx } from "../shared/permissions";
import { requireCourse, requireUser } from "../shared/require";
import { assertProblemHasWorkspaceForLanguages } from "../problem/permissions";
import { getProblemTotalScore } from "../problem/total-score";
import { stripUndefined } from "../shared/strip-undefined";
import { getDomainOrchestration } from "../shared/orchestration";
import { enforceSubmitCooldown } from "../shared/submit-cooldown";
import { assertEffectiveTimeWindow } from "../shared/effective-time-window";
import { examAutoCloseInput } from "../shared/lifecycle-input";
import { enqueueLifecycleCancellation } from "../shared/lifecycle-cancellation";

export type { ActorContext };

async function resolveAndAttachExamProblems(
  tx: TransactionClient,
  examId: string,
  problemIds: string[],
  allowedLanguages: Language[],
) {
  const problems = await problemRepo.withTx(tx).findMany({
    id: { in: problemIds },
  });
  const problemById = new Map(problems.map((p) => [p.id, p]));

  for (const id of problemIds) {
    if (!problemById.has(id)) {
      throw new NotFoundError(`Problem not found: ${id}`);
    }
  }

  if (allowedLanguages.length > 0) {
    await Promise.all(
      problemIds.map((id) => assertProblemHasWorkspaceForLanguages(tx, id, allowedLanguages)),
    );
  }

  await Promise.all(
    problemIds.map(async (id, index) => {
      const problem = problemById.get(id);
      if (!problem) return;
      await examProblemRepo.withTx(tx).create({
        examId,
        ordinal: index + 1,
        points: await getProblemTotalScore(tx, problem),
        problemId: problem.id,
      });
    }),
  );
}

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
) {
  await enforceSubmitCooldown(tx, { examId }, userId, problemId, cooldownSec);
}

export async function createExamRecord(actor: ActorContext, payload: ExamCreate) {
  const exam = await runTransaction(async (tx) => {
    await requireUser(tx, actor.userId);
    await courseRepo.withTx(tx).lockForUpdate(payload.courseId);
    const course = await requireCourse(tx, payload.courseId);

    if (actor.platformRole === "student") {
      const allowed = await isCourseStaffTx(tx, actor.userId, course.id);
      if (!allowed) {
        throw new ForbiddenError("Only course teachers and TAs may create exams.");
      }
    }

    const created = await examRepo.withTx(tx).create({
      allowedLanguages: payload.allowedLanguages,
      courseId: course.id,
      createdByUserId: actor.userId,
      endsAt: new Date(payload.endsAt),
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

    if (payload.problemIds.length > 0) {
      await resolveAndAttachExamProblems(
        tx,
        created.id,
        payload.problemIds,
        payload.allowedLanguages,
      );
    }

    return created;
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
    await examRepo.withTx(tx).lockForUpdate(examId);
    const exam = await requireExam(tx, examId);

    if (exam.createdByUserId !== actor.userId) {
      const allowed = await isCourseStaffTx(tx, actor.userId, exam.courseId);
      if (!allowed) {
        throw new ForbiddenError("You do not have permission to edit this exam.");
      }
    }

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
      fields: { start: "startsAt", end: "endsAt" },
    });

    const persisted =
      Object.keys(updateData).length > 0
        ? await examRepo.withTx(tx).update(exam.id, updateData)
        : exam;

    if (payload.problemIds !== undefined) {
      await examProblemRepo.withTx(tx).deleteByExamId(exam.id);
      const enforcedLanguages = payload.allowedLanguages ?? exam.allowedLanguages;
      await resolveAndAttachExamProblems(tx, exam.id, payload.problemIds, enforcedLanguages);
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

async function assertExamManagePermission(
  tx: TransactionClient,
  actor: ActorContext,
  exam: { createdByUserId: string | null; courseId: string },
) {
  if (exam.createdByUserId === actor.userId) return;
  const allowed = await isCourseStaffTx(tx, actor.userId, exam.courseId);
  if (!allowed) {
    throw new ForbiddenError("You do not have permission to manage this exam.");
  }
}

export async function publishExam(actor: ActorContext, examId: string): Promise<void> {
  const published = await runTransaction(async (tx) => {
    await examRepo.withTx(tx).lockForUpdate(examId);
    const exam = await requireExam(tx, examId);
    await assertExamManagePermission(tx, actor, exam);

    if (exam.status !== "draft") {
      throw new ValidationError("Only draft exams can be published.");
    }

    const problemCount = await examProblemRepo.withTx(tx).countByExamId(exam.id);

    if (problemCount === 0) {
      throw new ValidationError("Add at least one problem before publishing.");
    }
    if (exam.allowedLanguages.length === 0) {
      throw new ValidationError("Select at least one allowed language before publishing.");
    }
    assertEffectiveTimeWindow({
      start: exam.startsAt,
      end: exam.endsAt,
      fields: { start: "startsAt", end: "endsAt" },
    });
    if (exam.endsAt <= new Date()) {
      throw new ValidationError("End time must be in the future.");
    }

    return examRepo.withTx(tx).update(exam.id, { status: "published" });
  });

  await getDomainOrchestration().ensureExamAutoClose(examAutoCloseInput(published));
}

export async function deleteExamDraft(actor: ActorContext, examId: string): Promise<void> {
  await runTransaction(async (tx) => {
    await examRepo.withTx(tx).lockForUpdate(examId);
    const exam = await requireExam(tx, examId);
    await assertExamManagePermission(tx, actor, exam);

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
