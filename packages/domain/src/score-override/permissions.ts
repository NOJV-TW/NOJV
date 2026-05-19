import { assessmentRepo, contestRepo, courseMembershipRepo, examRepo } from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { assertContextClosed } from "../shared/context-window";
import { ForbiddenError } from "../shared/errors";
import type { ScoreOverrideContext } from "./types";

// Same shape as submission/permissions.ts's private helper — replicated locally
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
 * `ScoreOverrideContext` union makes that unrepresentable).
 *
 *   - platform admin → always
 *   - contest        → contest organizer (`Contest.createdByUserId`)
 *   - assignment     → course teacher/TA
 *   - exam           → course teacher/TA (via `Exam.courseId`)
 */
export async function canSetScoreOverride(
  actor: ActorContext,
  context: ScoreOverrideContext,
): Promise<boolean> {
  if (actor.platformRole === "admin") return true;

  switch (context.type) {
    case "contest": {
      const contest = await contestRepo.findById(context.contestId);
      return contest?.createdByUserId === actor.userId;
    }
    case "assignment": {
      const assignment = await assessmentRepo.findByIdWithCourseId(context.assignmentId);
      if (!assignment) return false;
      return isCourseTeacherOrTa(actor.userId, assignment.courseId);
    }
    case "exam": {
      const exam = await examRepo.findById(context.examId);
      if (!exam) return false;
      return isCourseTeacherOrTa(actor.userId, exam.courseId);
    }
  }
}

/**
 * Role-only assert: throws `ForbiddenError` unless `actor` is course staff /
 * contest organizer (or a platform admin) for `context`. Does NOT apply the
 * post-close gate — use this to authorize *reads* (listing overrides), which
 * staff may do while a context is still open. Writes must use
 * `assertCanSetScoreOverride`.
 */
export async function assertCanViewScoreOverrides(
  actor: ActorContext,
  context: ScoreOverrideContext,
): Promise<void> {
  if (!(await canSetScoreOverride(actor, context))) {
    throw new ForbiddenError("Not permitted to view score overrides for this context.");
  }
}

export async function assertCanSetScoreOverride(
  actor: ActorContext,
  context: ScoreOverrideContext,
): Promise<void> {
  await assertCanViewScoreOverrides(actor, context);
  // Score overrides are a post-close grading action: course staff may
  // only adjust scores once the context has ended. Platform admins
  // bypass the gate for emergency fixes.
  if (actor.platformRole !== "admin") {
    await assertContextClosed(context);
  }
}
