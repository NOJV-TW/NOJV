import { getAuditTimelineView } from "../audit/queries";
import {
  canAnswerInContext,
  canAskClarification,
  canViewClarifications,
} from "../clarification/permissions";
import { getAssignmentDetail } from "../course/assignment-detail";
import { listCourseProblemPickerGroups } from "../course/problem-library";
import { buildSubmissionsMatrix } from "../course/submissions-matrix";
import { getFeedbackForStudent } from "../feedback/queries";
import { listFlagsForContext } from "../plagiarism/flags";
import { findPlagiarismReport } from "../plagiarism/queries";
import { canSetScoreOverride } from "../score-override/permissions";
import type { ActorContext } from "../shared/actor-context";
import { listRecentContextSubmissions } from "../submission/history";

export async function getAssignmentPageView(
  actor: ActorContext,
  options: { courseId: string; assignmentId: string; isManager: boolean },
) {
  const { courseId, assignmentId } = options;
  const context = { type: "assignment", assignmentId } as const;

  if (options.isManager) {
    const [
      detail,
      matrix,
      plagiarism,
      plagiarismFlags,
      canSetOverride,
      canAsk,
      canAnswer,
      canView,
      audit,
      recentSubmissions,
    ] = await Promise.all([
      getAssignmentDetail(courseId, assignmentId, {
        viewerUserId: actor.userId,
        isManager: true,
      }),
      buildSubmissionsMatrix(courseId, assignmentId),
      findPlagiarismReport({ type: "assessment", id: assignmentId }),
      listFlagsForContext("assessment", assignmentId),
      canSetScoreOverride(actor, context),
      canAskClarification(actor, context),
      canAnswerInContext(actor, context),
      canViewClarifications(actor, context),
      getAuditTimelineView(context),
      listRecentContextSubmissions({
        actor,
        context: { type: "assignment", id: assignmentId },
      }),
    ]);

    const candidateProblems = await listCourseProblemPickerGroups(
      actor,
      courseId,
      detail.problems.map((problem) => problem.problemId),
    );

    return {
      mode: "teacher" as const,
      detail,
      matrix,
      candidateProblems,
      canSetOverride,
      clarification: { canAsk, canAnswer, canView },
      plagiarism,
      plagiarismFlags,
      auditEvents: audit.auditEvents,
      auditActorNames: audit.auditActorNames,
      recentSubmissions,
    };
  }

  const [detail, canAsk, canAnswer, canView, feedback] = await Promise.all([
    getAssignmentDetail(courseId, assignmentId, {
      viewerUserId: actor.userId,
      isManager: false,
    }),
    canAskClarification(actor, context),
    canAnswerInContext(actor, context),
    canViewClarifications(actor, context),
    getFeedbackForStudent(actor.userId, context),
  ]);
  return {
    mode: "student" as const,
    detail,
    clarification: { canAsk, canAnswer, canView },
    feedback: feedback.map((f) => ({ problemId: f.problemId, comment: f.comment })),
  };
}
