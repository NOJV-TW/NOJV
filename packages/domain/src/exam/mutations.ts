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
import { ForbiddenError, NotFoundError, ValidationError } from "../shared/errors";
import { requireCourse, requireUser } from "../shared/require";
import { assertProblemHasWorkspaceForLanguages } from "../problem/helpers";
import { stripUndefined } from "../shared/strip-undefined";

export type { ActorContext };

async function resolveAndAttachExamProblems(
  tx: TransactionClient,
  examId: string,
  problemIds: string[],
  allowedLanguages: Language[],
  pointOverrides?: Record<string, number>
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
      const points = pointOverrides?.[id];
      await examProblemRepo.withTx(tx).create({
        examId,
        ordinal: index + 1,
        points: typeof points === "number" && points >= 0 ? Math.floor(points) : 100,
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
      startsAt: exam.startsAt.toISOString(),
      endsAt: exam.endsAt.toISOString()
    });
  }

  return exam;
}

export interface UpdateExamOptions {
  /** Per-problem points override (problemId → points). Applied when
   *  the caller also passes `problemIds`; missing IDs fall back to the
   *  default of 100. */
  pointOverrides?: Record<string, number>;
}

export async function updateExamRecord(
  actor: ActorContext,
  examId: string,
  payload: ExamUpdate,
  options: UpdateExamOptions = {}
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
      await resolveAndAttachExamProblems(
        tx,
        exam.id,
        payload.problemIds,
        enforcedLanguages,
        options.pointOverrides
      );
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

export async function unfreezeExamBoard(examId: string): Promise<void> {
  await scoreboard.unfreezeScoreboard(examId);
  await examRepo.update(examId, { frozenBoard: false });
}

/**
 * Permission-gated wrapper around `freezeExamBoard` / `unfreezeExamBoard`
 * so route handlers don't need to reimplement the course-staff check
 * for scoreboard toggles.
 */
export async function setExamBoardFrozen(
  actor: ActorContext,
  examId: string,
  frozen: boolean
): Promise<void> {
  await runTransaction(async (tx) => {
    const exam = await requireExam(tx, examId);
    await assertExamManagePermission(tx, actor, exam);
  });
  if (frozen) await freezeExamBoard(examId);
  else await unfreezeExamBoard(examId);
}

export async function finalizeExam(examId: string): Promise<void> {
  await scoreboard.unfreezeScoreboard(examId);
  await examRepo.update(examId, { frozenBoard: false, status: "archived" });
}

// Owner-of-exam or active teacher/TA of the hosting course may manage it.
// Kept in sync with `updateExamRecord` / `createExamRecord` so Publish,
// Delete, Archive, and Unarchive all share the same gate.
async function assertExamManagePermission(
  tx: TransactionClient,
  actor: ActorContext,
  exam: { createdByUserId: string | null; courseId: string }
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

/**
 * Flip a draft exam to `published`. Validates the exam is actually
 * publishable (has problems, allowed languages, a sane window) and
 * schedules the auto-close workflow on commit.
 */
export async function publishExam(actor: ActorContext, examId: string): Promise<void> {
  const {
    examId: committedId,
    startsAt,
    endsAt
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
    if ((exam.allowedLanguages as Language[]).length === 0) {
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

  // Fires after commit so a rolled-back publish never leaves a phantom workflow behind.
  await dispatchExamAutoClose({
    examId: committedId,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString()
  });
}

/**
 * Delete a draft exam outright. Only draft status is permitted so
 * scoreboards / submissions tied to an active or archived exam stay
 * intact. Cascading relations (ExamProblem etc.) go with it via the
 * schema's onDelete rules.
 */
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

/**
 * Archive a published (or already-ended) exam. The exam row is kept so
 * scoreboards and submissions remain visible; status moves to
 * `archived` so the detail page hides it from students.
 */
export async function archiveExam(actor: ActorContext, examId: string): Promise<void> {
  await runTransaction(async (tx) => {
    const exam = await requireExam(tx, examId);
    await assertExamManagePermission(tx, actor, exam);

    if (exam.status !== "published") {
      throw new ValidationError("Only published exams can be archived.");
    }

    await examRepo.withTx(tx).update(exam.id, { status: "archived" });
  });
}

/**
 * Restore an archived exam back to `published`. Useful when an
 * instructor needs to re-open submissions review for students.
 */
export async function unarchiveExam(actor: ActorContext, examId: string): Promise<void> {
  await runTransaction(async (tx) => {
    const exam = await requireExam(tx, examId);
    await assertExamManagePermission(tx, actor, exam);

    if (exam.status !== "archived") {
      throw new ValidationError("Only archived exams can be unarchived.");
    }

    await examRepo.withTx(tx).update(exam.id, { status: "published" });
  });
}
