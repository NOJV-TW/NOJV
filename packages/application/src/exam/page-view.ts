import { getAuditTimelineView, type AuditEvent } from "../audit/queries";
import {
  canAnswerInContext,
  canAskClarification,
  canViewClarifications,
} from "../clarification/permissions";
import { listCourseProblemPickerGroups } from "../course/problem-library";
import { getFeedbackForStudent } from "../feedback/queries";
import { listFlagsForContext } from "../plagiarism/flags";
import { findPlagiarismReport } from "../plagiarism/queries";
import type { ProblemPickerGroups } from "../problem/picker";
import { canSetScoreOverride } from "../score-override/permissions";
import type { ActorContext } from "../shared/actor-context";
import { listRecentContextSubmissions } from "../submission/history";
import * as credentials from "./credentials";
import { getExamDetailPage } from "./detail";
import { listExamIpViolations } from "./queries";
import { getSessionState, listActiveSessions, listSubmittedProblemIds } from "./session";
import { buildExamSubmissionsMatrix } from "./submissions-matrix";

export async function getExamPageView(
  actor: ActorContext,
  options: { examId: string; isManager: boolean },
) {
  const { examId, isManager } = options;
  const noAudit = { auditEvents: [] as AuditEvent[], auditActorNames: {} };

  const [
    detail,
    canSetOverride,
    canAsk,
    canAnswer,
    canView,
    plagiarism,
    plagiarismFlags,
    ipViolations,
    activeSessions,
    feedback,
    audit,
    viewerSession,
    submittedProblemIds,
    recentSubmissions,
    examCredentials,
  ] = await Promise.all([
    getExamDetailPage(examId, { viewerUserId: actor.userId, isManager }),
    isManager ? canSetScoreOverride(actor, { type: "exam", examId }) : Promise.resolve(false),
    canAskClarification(actor, { type: "exam", examId }),
    canAnswerInContext(actor, { type: "exam", examId }),
    canViewClarifications(actor, { type: "exam", examId }),
    isManager ? findPlagiarismReport({ type: "exam", id: examId }) : Promise.resolve(null),
    isManager ? listFlagsForContext("exam", examId) : Promise.resolve([]),
    isManager ? listExamIpViolations({ examId }) : Promise.resolve([]),
    isManager ? listActiveSessions(examId) : Promise.resolve([]),
    isManager
      ? Promise.resolve([])
      : getFeedbackForStudent(actor.userId, { type: "exam", examId }),
    isManager ? getAuditTimelineView({ type: "exam", examId }) : Promise.resolve(noAudit),
    isManager ? Promise.resolve(null) : getSessionState(actor.userId, examId),
    isManager ? Promise.resolve([]) : listSubmittedProblemIds(actor.userId, examId),
    isManager
      ? listRecentContextSubmissions({ actor, context: { type: "exam", id: examId } })
      : Promise.resolve([]),
    isManager ? credentials.list(actor, examId) : Promise.resolve([]),
  ]);

  const candidateProblems: ProblemPickerGroups =
    isManager && detail
      ? await listCourseProblemPickerGroups(
          actor,
          detail.courseId,
          detail.problems.map((problem) => problem.id),
        )
      : { personalProblems: [], publicProblems: [] };

  const matrix =
    isManager && detail
      ? await buildExamSubmissionsMatrix({
          examId,
          courseId: detail.courseId,
          totalPoints: detail.totalPoints,
          endsAt: new Date(detail.endsAt),
          problems: detail.problems.map((p) => ({
            problemId: p.id,
            ordinal: p.ordinal,
            title: p.title,
            points: p.points,
          })),
        })
      : null;

  return {
    detail,
    hasActiveSession: viewerSession?.hasActiveSession ?? false,
    hasSubmitted: viewerSession?.hasSubmitted ?? false,
    submittedProblemIds,
    matrix,
    activeSessions,
    canSetOverride,
    clarification: { canAsk, canAnswer, canView },
    plagiarism,
    plagiarismFlags,
    ipViolations: ipViolations.map((v) => ({
      id: v.id,
      userId: v.userId,
      handle: v.user.displayUsername ?? v.user.email,
      displayName: v.user.name,
      violationType: v.violationType,
      expectedIp: v.expectedIp,
      actualIp: v.actualIp,
      createdAt: v.createdAt.toISOString(),
    })),
    feedback: feedback.map((f) => ({ problemId: f.problemId, comment: f.comment })),
    auditEvents: audit.auditEvents,
    auditActorNames: audit.auditActorNames,
    candidateProblems,
    recentSubmissions,
    examCredentials,
  };
}
