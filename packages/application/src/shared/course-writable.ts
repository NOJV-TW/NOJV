import { assessmentRepo, courseRepo, examRepo, type TransactionClient } from "@nojv/db";

import { NotFoundError, ValidationError } from "./errors";
import type { GradedContext } from "./graded-context";
import { requireCourse } from "./require";

export function assertCourseWritable(course: { archived: boolean }): void {
  if (course.archived) throw new ValidationError("Archived courses are read-only.");
}

export async function lockWritableCourse(tx: TransactionClient, courseId: string) {
  await courseRepo.withTx(tx).lockForShare(courseId);
  const course = await requireCourse(tx, courseId);
  assertCourseWritable(course);
  return course;
}

export async function lockWritableContextCourse(
  tx: TransactionClient,
  context: GradedContext,
): Promise<void> {
  if (context.type === "contest") return;
  const activity =
    context.type === "assignment"
      ? await assessmentRepo.withTx(tx).findById(context.assignmentId)
      : await examRepo.withTx(tx).findById(context.examId);
  if (!activity) throw new NotFoundError("Course activity not found.");
  await lockWritableCourse(tx, activity.courseId);
}
