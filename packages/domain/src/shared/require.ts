import {
  assessmentRepo,
  contestRepo,
  courseRepo,
  problemRepo,
  userRepo,
  type TransactionClient
} from "@nojv/db";

import { NotFoundError } from "./errors";

/**
 * Pure "exists-else-throw" helpers for the domain layer.
 *
 * Each helper takes a Prisma transaction client plus a lookup key,
 * calls the corresponding repository's findById/findBySlug, and throws
 * a `NotFoundError` when the entity does not exist.
 *
 * Access-check helpers (ownership, visibility, permission) belong in
 * their respective feature folders — only existence checks live here.
 */

export async function requireProblem(tx: TransactionClient, problemId: string) {
  const problem = await problemRepo.withTx(tx).findById(problemId);

  if (!problem) {
    throw new NotFoundError(`Problem not found: ${problemId}`);
  }

  return problem;
}

export async function requireContest(tx: TransactionClient, contestSlug: string) {
  const contest = await contestRepo.withTx(tx).findBySlug(contestSlug);

  if (!contest) {
    throw new NotFoundError(`Contest not found: ${contestSlug}`);
  }

  return contest;
}

export async function requireCourse(tx: TransactionClient, courseSlug: string) {
  const course = await courseRepo.withTx(tx).findBySlug(courseSlug);

  if (!course) {
    throw new NotFoundError(`Course not found: ${courseSlug}`);
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

export async function requireCourseAssessment(
  tx: TransactionClient,
  courseSlug: string,
  assessmentSlug: string
) {
  const course = await requireCourse(tx, courseSlug);
  const assessment = await assessmentRepo.withTx(tx).findByComposite(course.id, assessmentSlug);

  if (!assessment) {
    throw new NotFoundError(`Assessment not found: ${courseSlug}/${assessmentSlug}`);
  }

  return {
    assessment,
    course
  };
}
