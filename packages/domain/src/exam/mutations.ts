import {
  courseMembershipRepo,
  examParticipationRepo,
  examProblemRepo,
  examRepo,
  problemRepo,
  runTransaction,
  submissionRepo,
  type Prisma,
  type TransactionClient
} from "@nojv/db";
import type { ExamCreate, ExamUpdate, Language } from "@nojv/core";

import { dispatchExamAutoClose } from "@nojv/job-dispatch";
import { scoreboard } from "@nojv/redis";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { requireCourse, requireUser } from "../shared/require";
import { assertProblemHasWorkspaceForLanguages } from "../problem/helpers";
import { stripUndefined } from "../shared/strip-undefined";

export type { ActorContext };

async function resolveAndAttachExamProblems(
  tx: TransactionClient,
  examId: string,
  problemIds: string[],
  allowedLanguages: Language[]
) {
  const problems = await problemRepo.withTx(tx).findMany({
    id: { in: problemIds }
  });
  const problemById = new Map(problems.map((p) => [p.id, p]));

  for (const id of problemIds) {
    if (!problemById.has(id)) {
      throw new NotFoundError(`Problem not found: ${id}`);
    }
  }

  // Every allowedLanguage must have an editable main.<ext> on every problem.
  if (allowedLanguages.length > 0) {
    await Promise.all(
      problemIds.map((id) => assertProblemHasWorkspaceForLanguages(tx, id, allowedLanguages))
    );
  }

  await Promise.all(
    problemIds.map(async (id, index) => {
      const problem = problemById.get(id);
      if (!problem) return;
      await examProblemRepo.withTx(tx).create({
        examId,
        ordinal: index + 1,
        points: 100,
        problemId: problem.id
      });
    })
  );
}

async function requireExam(tx: TransactionClient, examId: string) {
  const exam = await examRepo.withTx(tx).findById(examId);
  if (!exam) {
    throw new NotFoundError(`Exam not found: ${examId}`);
  }
  return exam;
}

export async function ensureExamParticipation(
  tx: TransactionClient,
  userId: string,
  examId: string
) {
  const exam = await requireExam(tx, examId);

  if (exam.status !== "published") {
    throw new NotFoundError(`Exam not found: ${examId}`);
  }

  const now = new Date();
  if (now < exam.startsAt) {
    throw new ForbiddenError("Exam has not started yet.");
  }
  if (now > exam.endsAt) {
    throw new ForbiddenError("Exam has ended.");
  }

  const membership = await courseMembershipRepo
    .withTx(tx)
    .findByComposite(exam.courseId, userId);
  if (membership?.status !== "active") {
    throw new ForbiddenError("You must be enrolled in the course to take this exam.");
  }

  const participation = await examParticipationRepo.withTx(tx).upsert(
    exam.id,
    userId,
    {
      examId: exam.id,
      startedAt: new Date(),
      status: "active",
      userId
    },
    {
      status: "active"
    }
  );

  return { exam, participation };
}

export async function checkExamSubmitCooldown(
  tx: TransactionClient,
  examId: string,
  userId: string,
  problemId: string,
  cooldownSec: number
) {
  if (cooldownSec <= 0) return;

  const cutoff = new Date(Date.now() - cooldownSec * 1000);

  const recentSubmission = await submissionRepo.withTx(tx).findMostRecent({
    examId,
    userId,
    problemId,
    sampleOnly: false,
    createdAt: { gte: cutoff }
  });

  if (recentSubmission) {
    const waitUntil = new Date(recentSubmission.createdAt.getTime() + cooldownSec * 1000);
    const remainingSec = Math.ceil((waitUntil.getTime() - Date.now()) / 1000);
    throw new ForbiddenError(
      `Submit cooldown active. Please wait ${String(remainingSec)} seconds.`
    );
  }
}

export async function createExamRecord(actor: ActorContext, payload: ExamCreate) {
  const exam = await runTransaction(async (tx) => {
    await requireUser(tx, actor.userId);
    const course = await requireCourse(tx, payload.courseId);

    // Course teachers / TAs / owner may create exams. Students cannot.
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
      frozenAt: payload.frozenAt ? new Date(payload.frozenAt) : null,
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
      title: payload.title
    });

    if (payload.problemIds.length > 0) {
      await resolveAndAttachExamProblems(
        tx,
        created.id,
        payload.problemIds,
        payload.allowedLanguages
      );
    }

    return created;
  });

  // Fires after commit so a rolled-back creation never leaves a phantom workflow behind.
  if (exam.status === "published") {
    await dispatchExamAutoClose({
      examId: exam.id,
      endsAt: exam.endsAt.toISOString()
    });
  }

  return exam;
}

export async function updateExamRecord(
  actor: ActorContext,
  examId: string,
  payload: ExamUpdate
) {
  return runTransaction(async (tx) => {
    const exam = await requireExam(tx, examId);

    // Permission check — owner-of-course or contest creator
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
      scoreboardMode: payload.scoreboardMode
    });

    if (payload.startsAt !== undefined) updateData.startsAt = new Date(payload.startsAt);
    if (payload.endsAt !== undefined) updateData.endsAt = new Date(payload.endsAt);
    if (payload.frozenAt !== undefined) {
      updateData.frozenAt = payload.frozenAt ? new Date(payload.frozenAt) : null;
    }

    if (Object.keys(updateData).length > 0) {
      await examRepo.withTx(tx).update(exam.id, updateData);
    }

    if (payload.problemIds !== undefined) {
      await examProblemRepo.withTx(tx).deleteByExamId(exam.id);
      const enforcedLanguages =
        payload.allowedLanguages ?? (exam.allowedLanguages as Language[]);
      await resolveAndAttachExamProblems(tx, exam.id, payload.problemIds, enforcedLanguages);
    }

    return { id: exam.id };
  });
}

export interface ExamLifecycleInfo {
  endsAt: string;
  freezeTime: string | null;
  scoringMode: string;
  startsAt: string;
}

export async function getExamLifecycleInfo(examId: string): Promise<ExamLifecycleInfo> {
  const exam = await examRepo.findInfoById(examId);
  return {
    endsAt: exam.endsAt.toISOString(),
    freezeTime: exam.frozenAt?.toISOString() ?? null,
    scoringMode: exam.scoringMode,
    startsAt: exam.startsAt.toISOString()
  };
}

export async function activateExam(examId: string): Promise<void> {
  await examRepo.update(examId, { status: "published" });
}

export async function freezeExamBoard(examId: string): Promise<void> {
  await scoreboard.freezeScoreboard(examId);
  await examRepo.update(examId, { frozenBoard: true });
}

export async function finalizeExam(examId: string): Promise<void> {
  await scoreboard.unfreezeScoreboard(examId);
  await examRepo.update(examId, { frozenBoard: false, status: "archived" });
}
