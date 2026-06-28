import {
  courseMembershipRepo,
  examProblemRepo,
  examRepo,
  problemRepo,
  runTransaction,
  submissionRepo,
  type Prisma,
  type TransactionClient,
} from "@nojv/db";
import type { ExamCreate, ExamUpdate, Language } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError, ValidationError } from "../shared/errors";
import { requireCourse, requireUser } from "../shared/require";
import { assertProblemHasWorkspaceForLanguages } from "../problem/permissions";
import { stripUndefined } from "../shared/strip-undefined";
import { getDomainOrchestration } from "../shared/orchestration";

export type { ActorContext };

async function resolveAndAttachExamProblems(
  tx: TransactionClient,
  examId: string,
  problemIds: string[],
  allowedLanguages: Language[],
  pointOverrides?: Record<string, number>,
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
      const points = pointOverrides?.[id];
      await examProblemRepo.withTx(tx).create({
        examId,
        ordinal: index + 1,
        points: typeof points === "number" && points >= 0 ? Math.floor(points) : 100,
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
  if (cooldownSec <= 0) return;

  const lockKey = `${examId}:${userId}:${problemId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

  const cutoff = new Date(Date.now() - cooldownSec * 1000);

  const recentSubmission = await submissionRepo.withTx(tx).findMostRecent({
    examId,
    userId,
    problemId,
    sampleOnly: false,
    createdAt: { gte: cutoff },
  });

  if (recentSubmission) {
    const waitUntil = new Date(recentSubmission.createdAt.getTime() + cooldownSec * 1000);
    const remainingSec = Math.ceil((waitUntil.getTime() - Date.now()) / 1000);
    throw new ForbiddenError(
      `Submit cooldown active. Please wait ${String(remainingSec)} seconds.`,
    );
  }
}

export async function createExamRecord(actor: ActorContext, payload: ExamCreate) {
  const exam = await runTransaction(async (tx) => {
    await requireUser(tx, actor.userId);
    const course = await requireCourse(tx, payload.courseId);

    if (actor.platformRole === "student") {
      const membership = await courseMembershipRepo
        .withTx(tx)
        .findByComposite(course.id, actor.userId);
      const allowed =
        membership?.status === "active" &&
        (membership.role === "teacher" || membership.role === "ta");
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
    await getDomainOrchestration().dispatchExamAutoClose({
      examId: exam.id,
      startsAt: exam.startsAt.toISOString(),
      endsAt: exam.endsAt.toISOString(),
    });
  }

  return exam;
}

export interface UpdateExamOptions {
  pointOverrides?: Record<string, number>;
}

export async function updateExamRecord(
  actor: ActorContext,
  examId: string,
  payload: ExamUpdate,
  options: UpdateExamOptions = {},
) {
  const result = await runTransaction(async (tx) => {
    const exam = await requireExam(tx, examId);

    if (exam.createdByUserId !== actor.userId) {
      const membership = await courseMembershipRepo
        .withTx(tx)
        .findByComposite(exam.courseId, actor.userId);
      const allowed =
        membership?.status === "active" &&
        (membership.role === "teacher" || membership.role === "ta");
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

    if (payload.startsAt !== undefined) updateData.startsAt = new Date(payload.startsAt);
    if (payload.endsAt !== undefined) updateData.endsAt = new Date(payload.endsAt);

    if (Object.keys(updateData).length > 0) {
      await examRepo.withTx(tx).update(exam.id, updateData);
    }

    if (payload.problemIds !== undefined) {
      await examProblemRepo.withTx(tx).deleteByExamId(exam.id);
      const enforcedLanguages = payload.allowedLanguages ?? exam.allowedLanguages;
      await resolveAndAttachExamProblems(
        tx,
        exam.id,
        payload.problemIds,
        enforcedLanguages,
        options.pointOverrides,
      );
    }

    return {
      id: exam.id,
      status: exam.status,
      windowChanged: payload.startsAt !== undefined || payload.endsAt !== undefined,
      startsAt: payload.startsAt === undefined ? exam.startsAt : new Date(payload.startsAt),
      endsAt: payload.endsAt === undefined ? exam.endsAt : new Date(payload.endsAt),
    };
  });

  if (result.status === "published" && result.windowChanged) {
    await getDomainOrchestration().dispatchExamAutoClose({
      examId: result.id,
      startsAt: result.startsAt.toISOString(),
      endsAt: result.endsAt.toISOString(),
    });
  }

  return { id: result.id };
}

async function assertExamManagePermission(
  tx: TransactionClient,
  actor: ActorContext,
  exam: { createdByUserId: string | null; courseId: string },
) {
  if (exam.createdByUserId === actor.userId) return;
  const membership = await courseMembershipRepo
    .withTx(tx)
    .findByComposite(exam.courseId, actor.userId);
  const allowed =
    membership?.status === "active" &&
    (membership.role === "teacher" || membership.role === "ta");
  if (!allowed) {
    throw new ForbiddenError("You do not have permission to manage this exam.");
  }
}

export async function publishExam(actor: ActorContext, examId: string): Promise<void> {
  const {
    examId: committedId,
    startsAt,
    endsAt,
  } = await runTransaction(async (tx) => {
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
    if (exam.startsAt >= exam.endsAt) {
      throw new ValidationError("Start time must be before end time.");
    }
    if (exam.endsAt <= new Date()) {
      throw new ValidationError("End time must be in the future.");
    }

    await examRepo.withTx(tx).update(exam.id, { status: "published" });

    return { examId: exam.id, startsAt: exam.startsAt, endsAt: exam.endsAt };
  });

  await getDomainOrchestration().dispatchExamAutoClose({
    examId: committedId,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  });
}

export async function deleteExamDraft(actor: ActorContext, examId: string): Promise<void> {
  await runTransaction(async (tx) => {
    const exam = await requireExam(tx, examId);
    await assertExamManagePermission(tx, actor, exam);

    if (exam.status !== "draft") {
      throw new ValidationError("Only draft exams can be deleted.");
    }

    await examRepo.withTx(tx).delete(exam.id);
  });
}
