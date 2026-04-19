import {
  assessmentRepo,
  contestRepo,
  courseMembershipRepo,
  examRepo,
  type OverrideContextType
} from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError } from "../shared/errors";

// Same shape as submission/authz.ts's private helper — replicated locally
// to avoid leaking a private helper across modules. Keep in sync if the
// course-staff definition ever widens.
async function isCourseTeacherOrTa(userId: string, courseId: string): Promise<boolean> {
  const membership = await courseMembershipRepo.findByComposite(courseId, userId);
  if (membership?.status !== "active") return false;
  return membership.role === "teacher" || membership.role === "ta";
}

/**
 * Can `actor` set / edit / delete a score override in the given context?
 *
 * Matches `canOperateOnSubmission` for contest / assignment / exam targets,
 * minus the practice branch (practice is not an override context — the
 * `OverrideContextType` enum makes that unrepresentable).
 *
 *   - platform admin → always
 *   - contest        → contest organizer (`Contest.createdByUserId`)
 *   - assignment     → course teacher/TA
 *   - exam           → course teacher/TA (via `Exam.courseId`)
 */
export async function canSetScoreOverride(
  actor: ActorContext,
  contextType: OverrideContextType,
  contextId: string
): Promise<boolean> {
  if (actor.platformRole === "admin") return true;

  switch (contextType) {
    case "contest": {
      const contest = await contestRepo.findById(contextId);
      return contest?.createdByUserId === actor.userId;
    }
    case "assignment": {
      const assessment = await assessmentRepo.findByIdWithCourseId(contextId);
      if (!assessment) return false;
      return isCourseTeacherOrTa(actor.userId, assessment.courseId);
    }
    case "exam": {
      const exam = await examRepo.findById(contextId);
      if (!exam) return false;
      return isCourseTeacherOrTa(actor.userId, exam.courseId);
    }
  }
}

export async function assertCanSetScoreOverride(
  actor: ActorContext,
  contextType: OverrideContextType,
  contextId: string
): Promise<void> {
  if (!(await canSetScoreOverride(actor, contextType, contextId))) {
    throw new ForbiddenError("Not permitted to set score overrides for this context.");
  }
}
