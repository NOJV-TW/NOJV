import {
  assessmentRepo,
  contestRepo,
  courseRepo,
  problemRepo,
  userRepo,
  type TransactionClient,
} from "@nojv/db";

import { NotFoundError } from "./errors";

export async function requireProblem(tx: TransactionClient, problemId: string) {
  const problem = await problemRepo.withTx(tx).findById(problemId);

  if (!problem) {
    throw new NotFoundError(`Problem not found: ${problemId}`);
  }

  return problem;
}

export async function requireContest(tx: TransactionClient, contestId: string) {
  const contest = await contestRepo.withTx(tx).findById(contestId);

  if (!contest) {
    throw new NotFoundError(`Contest not found: ${contestId}`);
  }

  return contest;
}

export async function requireCourse(tx: TransactionClient, courseId: string) {
  const course = await courseRepo.withTx(tx).findById(courseId);

  if (!course) {
    throw new NotFoundError(`Course not found: ${courseId}`);
  }

  return course;
}

export async function requireUser(tx: TransactionClient, userId: string) {
  const existing = await userRepo.withTx(tx).findById(userId);

  if (!existing) {
    throw new NotFoundError(`User not found: ${userId}`);
  }

  return existing;
}

export async function requireCourseAssignment(
  tx: TransactionClient,
  courseId: string,
  assignmentId: string,
) {
  const course = await requireCourse(tx, courseId);
  const assignment = await assessmentRepo.withTx(tx).findByCompositeId(course.id, assignmentId);

  if (!assignment) {
    throw new NotFoundError(`Assignment not found: ${courseId}/${assignmentId}`);
  }

  return {
    assignment,
    course,
  };
}
