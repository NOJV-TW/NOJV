import {
  assessmentRepo,
  contestRepo,
  courseMembershipRepo,
  examRepo,
  problemRepo
} from "@nojv/db";

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
  }
): Promise<boolean> {
  if (actor.platformRole === "admin") return true;

  if (submission.contestId) {
    const contest = await contestRepo.findById(submission.contestId);
    return contest?.createdByUserId === actor.userId;
  }

  if (submission.courseAssessmentId) {
    const assessment = await assessmentRepo.findByIdWithCourseId(submission.courseAssessmentId);
    if (!assessment) return false;
    return isCourseTeacherOrTa(actor.userId, assessment.courseId);
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
  }
): Promise<void> {
  if (!(await canOperateOnSubmission(actor, submission))) {
    throw new ForbiddenError("Not permitted to operate on this submission.");
  }
}
