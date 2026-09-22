import { assessmentRepo, examRepo } from "@nojv/db";

import { ConflictError, NotFoundError } from "./errors";
import type { CourseActivityContext } from "./graded-context";

export type GradableContext = CourseActivityContext;

export async function isContextClosed(context: GradableContext): Promise<boolean> {
  const now = Date.now();

  switch (context.type) {
    case "assignment": {
      const assignment = await assessmentRepo.findByIdWithCourseId(context.assignmentId);
      if (!assignment) throw new NotFoundError("Assignment not found.");
      return now > assignment.closesAt.getTime();
    }
    case "exam": {
      const exam = await examRepo.findById(context.examId);
      if (!exam) throw new NotFoundError("Exam not found.");
      return now > exam.endsAt.getTime();
    }
  }
}

export async function assertContextClosed(context: GradableContext): Promise<void> {
  if (!(await isContextClosed(context))) {
    throw new ConflictError(
      "This context is still open; grading is only available after it closes.",
    );
  }
}
