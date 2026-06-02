import {
  assessmentRepo,
  contestRepo,
  courseMembershipRepo,
  examRepo,
  problemRepo,
  submissionRepo,
} from "@nojv/db";
import type { RejudgeInput } from "@nojv/temporal";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError } from "../shared/errors";

async function isCourseTeacherOrTa(userId: string, courseId: string): Promise<boolean> {
  const membership = await courseMembershipRepo.findByComposite(courseId, userId);
  if (membership?.status !== "active") return false;
  return membership.role === "teacher" || membership.role === "ta";
}

export async function canOperateOnSubmission(
  actor: ActorContext,
  submission: {
    id: string;
    userId: string;
    problemId: string;
    contestId?: string | null;
    courseAssessmentId?: string | null;
    examId?: string | null;
  },
): Promise<boolean> {
  if (actor.platformRole === "admin") return true;

  if (submission.contestId) {
    const contest = await contestRepo.findById(submission.contestId);
    return contest?.createdByUserId === actor.userId;
  }

  if (submission.courseAssessmentId) {
    const assignment = await assessmentRepo.findByIdWithCourseId(submission.courseAssessmentId);
    if (!assignment) return false;
    return isCourseTeacherOrTa(actor.userId, assignment.courseId);
  }

  if (submission.examId) {
    const exam = await examRepo.findById(submission.examId);
    if (!exam) return false;
    return isCourseTeacherOrTa(actor.userId, exam.courseId);
  }

  const problem = await problemRepo.findById(submission.problemId);
  return problem?.authorId === actor.userId;
}

export async function assertCanOperateOnSubmission(
  actor: ActorContext,
  submission: {
    id: string;
    userId: string;
    problemId: string;
    contestId?: string | null;
    courseAssessmentId?: string | null;
    examId?: string | null;
  },
): Promise<void> {
  if (!(await canOperateOnSubmission(actor, submission))) {
    throw new ForbiddenError("Not permitted to operate on this submission.");
  }
}

export async function assertBatchRejudgeAccess(
  actor: ActorContext,
  input: Extract<RejudgeInput, { mode: "batch" }>,
): Promise<void> {
  if (actor.platformRole === "admin") return;

  if (input.contestId) {
    const contest = await contestRepo.findById(input.contestId);
    if (contest?.createdByUserId !== actor.userId) {
      throw new ForbiddenError("Not the contest organizer.");
    }
    return;
  }

  if (input.assessmentId) {
    const assignment = await assessmentRepo.findByIdWithCourseId(input.assessmentId);
    if (!assignment || !(await isCourseTeacherOrTa(actor.userId, assignment.courseId))) {
      throw new ForbiddenError("Not course staff for this assignment.");
    }
    return;
  }

  if (input.examId) {
    const exam = await examRepo.findById(input.examId);
    if (!exam || !(await isCourseTeacherOrTa(actor.userId, exam.courseId))) {
      throw new ForbiddenError("Not course staff for this exam.");
    }
    return;
  }

  const problem = await problemRepo.findById(input.problemId);
  if (problem?.authorId !== actor.userId) {
    throw new ForbiddenError(
      "Batch rejudge without a context scope is limited to the problem author.",
    );
  }

  const anyNonPractice = await submissionRepo.anyWithContextForProblem(input.problemId);
  if (anyNonPractice) {
    throw new ForbiddenError(
      "Batch rejudge includes non-practice submissions; scope to a specific context.",
    );
  }
}
