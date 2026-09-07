import { assertEffectiveTimeWindow } from "../shared/effective-time-window";
import { assertLateSubmissionPolicy } from "../shared/late-submission-policy";
import { saveActivityGrading } from "../scoring/activity-grading";
import {
  assessmentProblemRepo,
  assessmentRepo,
  courseMembershipRepo,
  courseRepo,
  examProblemRepo,
  examRepo,
  Prisma,
  runTransaction,
  type TransactionClient,
} from "@nojv/db";
import type { CourseAssignmentFormData, CourseCreate, CourseUpdate } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../shared/errors";
import { canManageCourse, resolveEffectiveCourseRole } from "../shared/permissions";
import { requireCourse } from "../shared/require";
import { requireUser } from "../shared/require";
import { resolveActivityProblems } from "../problem/fork";
import { assignmentDueSoonInput } from "../shared/lifecycle-input";
import { getDomainOrchestration } from "../shared/orchestration";

async function assertCourseManager(
  tx: TransactionClient,
  actor: ActorContext,
  courseId: string,
) {
  if (actor.platformRole === "admin") return;

  const membership = await courseMembershipRepo
    .withTx(tx)
    .findByComposite(courseId, actor.userId);
  const effectiveRole = resolveEffectiveCourseRole(
    actor.platformRole,
    membership?.role ?? null,
  );
  if (!canManageCourse(effectiveRole) || membership?.status !== "active") {
    throw new ForbiddenError("You do not have permission to manage this course.");
  }
}

export async function createCourseRecord(actor: ActorContext, payload: CourseCreate) {
  return runTransaction(async (tx) => {
    const owner = await requireUser(tx, actor.userId);
    const course = await courseRepo.withTx(tx).create({
      description: payload.description,
      ownerId: owner.id,
      title: payload.title,
      ...(payload.academicYear != null ? { academicYear: payload.academicYear } : {}),
      ...(payload.semester != null ? { semester: payload.semester } : {}),
    });

    await courseMembershipRepo.withTx(tx).create({
      addedByUserId: owner.id,
      courseId: course.id,
      joinedAt: new Date(),
      role: "teacher",
      status: "active",
      userId: owner.id,
    });

    return { course };
  });
}

function generateAssignmentId(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = Date.now().toString(36).slice(-6);
  const core = base.length > 0 ? base : "assignment";
  return `${core}-${suffix}`;
}

export async function createCourseAssignmentRecord(
  actor: ActorContext,
  courseId: string,
  payload: CourseAssignmentFormData,
) {
  const assignment = await runTransaction(async (tx) => {
    await courseRepo.withTx(tx).lockForUpdate(courseId);
    const course = await requireCourse(tx, courseId);
    await assertCourseManager(tx, actor, course.id);
    const creator = await requireUser(tx, actor.userId);

    const assignmentId = generateAssignmentId(payload.title);

    const closesAt = new Date(payload.allowLateSubmissions ? payload.closesAt : payload.dueAt);
    const dueAt = new Date(payload.dueAt);
    const adjustmentRules =
      payload.allowLateSubmissions && payload.latePenalty ? [payload.latePenalty] : [];
    assertEffectiveTimeWindow({
      start: new Date(payload.opensAt),
      due: dueAt,
      end: closesAt,
      fields: { start: "opensAt", due: "dueAt", end: "closesAt" },
    });
    if (payload.allowLateSubmissions && closesAt <= dueAt)
      throw new ValidationError(
        "closesAt must be later than dueAt when late submissions are allowed.",
      );
    assertLateSubmissionPolicy(adjustmentRules, dueAt, closesAt);

    const assignment = await assessmentRepo.withTx(tx).create({
      allowedLanguages: payload.allowedLanguages,
      closesAt,
      courseId: course.id,
      createdByUserId: creator.id,
      dueAt,
      opensAt: new Date(payload.opensAt),
      id: assignmentId,
      status: payload.status,
      summary: payload.title,
      title: payload.title,
      ...(payload.maxAttemptsPerDay != null
        ? { maxAttemptsPerDay: payload.maxAttemptsPerDay }
        : {}),
      ...(payload.attemptResetMinuteOfDay != null
        ? { attemptResetMinuteOfDay: payload.attemptResetMinuteOfDay }
        : {}),
      ...(adjustmentRules.length > 0 ? { adjustmentRules: adjustmentRules } : {}),
    });

    const grading = await saveActivityGrading(tx, actor, {
      type: "assignment",
      id: assignment.id,
      totalPoints: payload.totalPoints,
      problems: payload.problems,
      published: payload.status === "published",
      allowedLanguages: payload.allowedLanguages,
    });

    return { ...assignment, ...grading };
  });

  if (assignment.status === "published") {
    await getDomainOrchestration().ensureAssignmentDueSoon(assignmentDueSoonInput(assignment));
  }

  return assignment;
}

export async function updateCourse(
  actor: ActorContext,
  courseId: string,
  payload: CourseUpdate,
) {
  return runTransaction(async (tx) => {
    await courseRepo.withTx(tx).lockForUpdate(courseId);
    await requireCourse(tx, courseId);
    await assertCourseManager(tx, actor, courseId);

    return courseRepo.withTx(tx).update(courseId, {
      description: payload.description,
      title: payload.title,
      academicYear: payload.academicYear ?? null,
      semester: payload.semester ?? null,
    });
  });
}

export async function deleteCourse(actor: ActorContext, courseId: string) {
  return runTransaction(async (tx) => {
    await courseRepo.withTx(tx).lockForUpdate(courseId);
    await requireCourse(tx, courseId);
    await assertCourseManager(tx, actor, courseId);

    try {
      return await courseRepo.withTx(tx).delete(courseId);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        throw new ConflictError(
          "This course has submissions and cannot be deleted. Archive it instead.",
        );
      }
      throw err;
    }
  });
}

export async function setCourseArchived(
  actor: ActorContext,
  courseId: string,
  archived: boolean,
) {
  return runTransaction(async (tx) => {
    await courseRepo.withTx(tx).lockForUpdate(courseId);
    await requireCourse(tx, courseId);
    await assertCourseManager(tx, actor, courseId);

    return courseRepo.withTx(tx).update(courseId, { archived });
  });
}

export async function copyCourse(
  actor: ActorContext,
  sourceCourseId: string,
  newTitle: string,
): Promise<{ newCourseId: string }> {
  const trimmedTitle = newTitle.trim();
  if (trimmedTitle.length === 0) {
    throw new ValidationError("New course title is required.");
  }
  if (trimmedTitle.length > 120) {
    throw new ValidationError("New course title must be 120 characters or fewer.");
  }

  return runTransaction(async (tx) => {
    await courseRepo.withTx(tx).lockForUpdate(sourceCourseId);
    const source = await requireCourse(tx, sourceCourseId);
    await assertCourseManager(tx, actor, source.id);

    const owner = await requireUser(tx, actor.userId);

    const newCourse = await courseRepo.withTx(tx).create({
      description: source.description,
      ownerId: owner.id,
      title: trimmedTitle,
      ...(source.academicYear != null ? { academicYear: source.academicYear } : {}),
      ...(source.semester != null ? { semester: source.semester } : {}),
    });

    await courseMembershipRepo.withTx(tx).create({
      addedByUserId: owner.id,
      courseId: newCourse.id,
      joinedAt: new Date(),
      role: "teacher",
      status: "active",
      userId: owner.id,
    });

    const sourceAssignments = await assessmentRepo
      .withTx(tx)
      .listByCourseIdAllWithProblems(source.id);

    for (const a of sourceAssignments) {
      const created = await assessmentRepo.withTx(tx).create({
        allowedLanguages: a.allowedLanguages,
        closesAt: a.closesAt,
        courseId: newCourse.id,
        createdByUserId: owner.id,
        dueAt: a.dueAt,
        opensAt: a.opensAt,
        status: "draft",
        summary: a.summary,
        title: a.title,
        totalPoints: a.totalPoints,
        ...(a.maxAttemptsPerDay != null ? { maxAttemptsPerDay: a.maxAttemptsPerDay } : {}),
        ...(a.attemptResetMinuteOfDay != null
          ? { attemptResetMinuteOfDay: a.attemptResetMinuteOfDay }
          : {}),
        ...(a.adjustmentRules != null ? { adjustmentRules: a.adjustmentRules } : {}),
      });

      const assignmentProblems = await resolveActivityProblems(
        tx,
        actor,
        a.problems.map((problem) => problem.problemId),
      );
      for (const [index, p] of a.problems.entries()) {
        const problem = assignmentProblems[index];
        if (!problem) throw new NotFoundError(`Problem not found: ${p.problemId}`);
        await assessmentProblemRepo.withTx(tx).create({
          assessmentId: created.id,
          ordinal: p.ordinal,
          points: p.points,
          problemId: problem.id,
        });
      }
    }

    const sourceExams = await examRepo.withTx(tx).listByCourseIdAllWithProblems(source.id);

    for (const e of sourceExams) {
      const created = await examRepo.withTx(tx).create({
        allowedLanguages: e.allowedLanguages,
        courseId: newCourse.id,
        createdByUserId: owner.id,
        endsAt: e.endsAt,
        dueAt: e.dueAt,
        ...(e.adjustmentRules != null ? { adjustmentRules: e.adjustmentRules } : {}),
        ipBindingEnabled: e.ipBindingEnabled,
        ipViolationMode: e.ipViolationMode,
        ipWhitelist: e.ipWhitelist,
        ipWhitelistEnabled: e.ipWhitelistEnabled,
        pageLockEnabled: e.pageLockEnabled,
        scoreboardMode: e.scoreboardMode,
        scoringMode: e.scoringMode,
        startsAt: e.startsAt,
        status: "draft",
        submitCooldownSec: e.submitCooldownSec,
        summary: e.summary,
        title: e.title,
        totalPoints: e.totalPoints,
      });

      const examProblems = await resolveActivityProblems(
        tx,
        actor,
        e.problems.map((problem) => problem.problemId),
      );
      for (const [index, p] of e.problems.entries()) {
        const problem = examProblems[index];
        if (!problem) throw new NotFoundError(`Problem not found: ${p.problemId}`);
        await examProblemRepo.withTx(tx).create({
          examId: created.id,
          ordinal: p.ordinal,
          points: p.points,
          problemId: problem.id,
        });
      }
    }

    return { newCourseId: newCourse.id };
  });
}
