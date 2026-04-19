import {
  assessmentRepo,
  contestParticipationRepo,
  contestRepo,
  courseMembershipRepo,
  examParticipationRepo,
  examRepo
} from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError } from "../shared/errors";

export type ClarificationContextType = "contest" | "exam" | "assignment";

/**
 * Shared helper — same definition as submission/authz and
 * score-override/authz. Kept private to the module so the three files
 * evolve independently if the course-staff definition ever widens.
 */
async function isCourseTeacherOrTa(userId: string, courseId: string): Promise<boolean> {
  const membership = await courseMembershipRepo.findByComposite(courseId, userId);
  if (membership?.status !== "active") return false;
  return membership.role === "teacher" || membership.role === "ta";
}

async function hasContestParticipation(userId: string, contestId: string): Promise<boolean> {
  // `listParticipantUserIds` is the cheapest existing read; a dedicated
  // point lookup (exists(contestId, userId)) would be marginally faster
  // but needs a new repo method. Keep it simple until there's a hot path.
  const ids = await contestParticipationRepo.listParticipantUserIds(contestId);
  return ids.includes(userId);
}

async function hasExamParticipation(userId: string, examId: string): Promise<boolean> {
  const ids = await examParticipationRepo.listParticipantUserIds(examId);
  return ids.includes(userId);
}

async function isActiveStudentInAssessment(
  userId: string,
  assessmentId: string
): Promise<boolean> {
  const assessment = await assessmentRepo.findByIdWithCourseId(assessmentId);
  if (!assessment) return false;
  const membership = await courseMembershipRepo.findByComposite(assessment.courseId, userId);
  if (membership?.status !== "active") return false;
  return membership.role === "student";
}

/**
 * Can `actor` ask a clarification in this context?
 *
 * Admins are NOT allowed — preserves the "staff cannot drop hints via
 * questions" invariant. Students ask via their participation:
 *   - contest    → ContestParticipation row
 *   - exam       → ExamParticipation row
 *   - assignment → active student membership in the course
 */
export async function canAskClarification(
  actor: ActorContext,
  contextType: ClarificationContextType,
  contextId: string
): Promise<boolean> {
  if (actor.platformRole === "admin") return false;

  switch (contextType) {
    case "contest":
      return hasContestParticipation(actor.userId, contextId);
    case "exam":
      return hasExamParticipation(actor.userId, contextId);
    case "assignment":
      return isActiveStudentInAssessment(actor.userId, contextId);
  }
}

/**
 * Can `actor` answer or dismiss in this context?
 *
 * Matches the submission-operation permission matrix:
 *   - platform admin → always
 *   - contest        → contest organizer (`Contest.createdByUserId`)
 *   - exam           → course teacher/TA (via `Exam.courseId`)
 *   - assignment     → course teacher/TA (via `CourseAssessment.courseId`)
 */
export async function canAnswerInContext(
  actor: ActorContext,
  contextType: ClarificationContextType,
  contextId: string
): Promise<boolean> {
  if (actor.platformRole === "admin") return true;

  switch (contextType) {
    case "contest": {
      const contest = await contestRepo.findById(contextId);
      return contest?.createdByUserId === actor.userId;
    }
    case "exam": {
      const exam = await examRepo.findById(contextId);
      if (!exam) return false;
      return isCourseTeacherOrTa(actor.userId, exam.courseId);
    }
    case "assignment": {
      const assessment = await assessmentRepo.findByIdWithCourseId(contextId);
      if (!assessment) return false;
      return isCourseTeacherOrTa(actor.userId, assessment.courseId);
    }
  }
}

/**
 * Who sees unmasked asker identity? Same set as "who can answer" —
 * staff of the context.
 */
export const canSeeAuthor = canAnswerInContext;

export async function assertCanAskClarification(
  actor: ActorContext,
  contextType: ClarificationContextType,
  contextId: string
): Promise<void> {
  if (!(await canAskClarification(actor, contextType, contextId))) {
    throw new ForbiddenError("Only participants may ask clarifications.");
  }
}

export async function assertCanAnswerInContext(
  actor: ActorContext,
  contextType: ClarificationContextType,
  contextId: string
): Promise<void> {
  if (!(await canAnswerInContext(actor, contextType, contextId))) {
    throw new ForbiddenError("Not permitted to answer clarifications in this context.");
  }
}
