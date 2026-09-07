import {
  assessmentProblemRepo,
  assessmentRepo,
  examProblemRepo,
  examRepo,
  scoreOverrideRepo,
  type TransactionClient,
} from "@nojv/db";

import { lockCourseMembers } from "../course/roster";
import type { ActorContext } from "../shared/actor-context";
import { isCourseStaffTx } from "../shared/permissions";
import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import type { GradedContext } from "../shared/graded-context";

type CourseGradingContext = Exclude<GradedContext, { type: "contest" }>;

export async function lockCourseGradingContext(
  tx: TransactionClient,
  context: CourseGradingContext,
  actor: ActorContext,
): Promise<string> {
  const repo = context.type === "assignment" ? assessmentRepo.withTx(tx) : examRepo.withTx(tx);
  const contextId = context.type === "assignment" ? context.assignmentId : context.examId;
  const initial = await repo.findById(contextId);
  if (!initial) throw new NotFoundError("Grading context not found.");
  await lockCourseMembers(tx, initial.courseId);
  await repo.lockForUpdate(contextId);
  const row = await repo.findById(contextId);
  if (!row) throw new NotFoundError("Grading context not found.");
  if (row.courseId !== initial.courseId)
    throw new ConflictError("Grading context changed course. Try again.");
  if (actor.platformRole !== "admin") {
    if (!(await isCourseStaffTx(tx, actor.userId, row.courseId))) {
      throw new ForbiddenError("Not permitted to grade this course.");
    }
    const closesAt = "closesAt" in row ? row.closesAt : row.endsAt;
    if (Date.now() <= closesAt.getTime()) {
      throw new ConflictError(
        "This context is still open; grading is only available after it closes.",
      );
    }
  }
  return row.courseId;
}

export async function assertCourseGradingSubject(
  tx: TransactionClient,
  courseId: string,
  context: CourseGradingContext,
  problemId: string,
  courseMembershipId: string,
) {
  const [problemInContext, membership] = await Promise.all([
    context.type === "assignment"
      ? assessmentProblemRepo.withTx(tx).findLink(context.assignmentId, problemId)
      : examProblemRepo.withTx(tx).exists(context.examId, problemId),
    scoreOverrideRepo.findCourseStudent(tx, courseId, courseMembershipId),
  ]);
  if (!problemInContext) throw new NotFoundError("Problem is not part of this context.");
  if (!membership) throw new NotFoundError("Student is not actively enrolled in this course.");
  return membership;
}
