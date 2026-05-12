import {
  assessmentRepo,
  contestRepo,
  courseMembershipRepo,
  examRepo,
  problemRepo,
  submissionRepo,
} from "@nojv/db";
import type { RejudgeInput } from "@nojv/job-dispatch";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError } from "../shared/errors";

/**
 * Shared helper: can `userId` act as course staff (teacher or TA) on `courseId`?
 * Platform admins bypass this entirely at the caller.
 */
async function isCourseTeacherOrTa(userId: string, courseId: string): Promise<boolean> {
  const membership = await courseMembershipRepo.findByComposite(courseId, userId);
  if (membership?.status !== "active") return false;
  return membership.role === "teacher" || membership.role === "ta";
}

/**
 * Can `actor` perform destructive operations (rejudge, score-override) on
 * the given submission? See the "submission operation permission" memo:
 *
 *   - platform admin   → always
 *   - contest context  → contest organizer (`Contest.createdByUserId`)
 *   - assignment       → course teacher/TA
 *   - exam             → course teacher/TA (via `Exam.courseId`)
 *   - practice         → problem author (`Problem.authorId`)
 */
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

  // practice context — problem author only
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

/**
 * Authorization for batch-rejudge inputs. The input mirrors the shape
 * used by `dispatchRejudge` in batch mode. Checks the context-specific
 * permission; for an unscoped batch (bare `problemId`) the problem author
 * is allowed, but only if no matching submissions live in a non-practice
 * context (those must be scoped by contest / assignment / exam).
 */
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

  // Unscoped batch on bare problemId — problem author only, and reject if
  // any matching submission is in a non-practice context.
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
