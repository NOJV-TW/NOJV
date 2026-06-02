import {
  assessmentAuditLogRepo,
  scoreOverrideAuditLogRepo,
  submissionRejudgeLogRepo,
  submissionRepo,
} from "@nojv/db";

import type { GradableContext } from "../shared/context-window";

export type AuditEventKind = "lifecycle" | "score_override" | "rejudge";

type LifecycleRow = Awaited<ReturnType<typeof assessmentAuditLogRepo.listByAssessment>>[number];
type ScoreOverrideRow = Awaited<
  ReturnType<typeof scoreOverrideAuditLogRepo.listForContext>
>[number];
type RejudgeRow = Awaited<
  ReturnType<typeof submissionRejudgeLogRepo.listForSubmissionIds>
>[number];

interface AuditEventBase {
  at: Date;
  actorUserId: string | null;
}

export interface LifecycleAuditEvent extends AuditEventBase {
  kind: "lifecycle";
  detail: { action: LifecycleRow["action"] };
}

export interface ScoreOverrideAuditEvent extends AuditEventBase {
  kind: "score_override";
  detail: {
    action: ScoreOverrideRow["action"];
    userId: ScoreOverrideRow["userId"];
    problemId: ScoreOverrideRow["problemId"];
    oldScore: ScoreOverrideRow["oldScore"];
    newScore: ScoreOverrideRow["newScore"];
    oldReason: ScoreOverrideRow["oldReason"];
    newReason: ScoreOverrideRow["newReason"];
  };
}

export interface RejudgeAuditEvent extends AuditEventBase {
  kind: "rejudge";
  detail: {
    submissionId: RejudgeRow["submissionId"];
    oldVerdict: RejudgeRow["oldVerdict"];
    newVerdict: RejudgeRow["newVerdict"];
    oldScore: RejudgeRow["oldScore"];
    newScore: RejudgeRow["newScore"];
  };
}

export type AuditEvent = LifecycleAuditEvent | ScoreOverrideAuditEvent | RejudgeAuditEvent;

export async function listAuditTimelineForContext(
  context: GradableContext,
): Promise<AuditEvent[]> {
  const lifecycleP: Promise<LifecycleAuditEvent[]> =
    context.type === "assignment"
      ? assessmentAuditLogRepo.listByAssessment(context.assignmentId).then((rows) =>
          rows.map((row) => ({
            at: row.createdAt,
            actorUserId: row.actorUserId,
            kind: "lifecycle" as const,
            detail: { action: row.action },
          })),
        )
      : Promise.resolve([]);

  const contextId =
    context.type === "assignment"
      ? context.assignmentId
      : context.type === "exam"
        ? context.examId
        : context.contestId;

  const overrideP: Promise<ScoreOverrideAuditEvent[]> = scoreOverrideAuditLogRepo
    .listForContext(context.type, contextId)
    .then((rows) =>
      rows.map((row) => ({
        at: row.createdAt,
        actorUserId: row.changedByUserId,
        kind: "score_override" as const,
        detail: {
          action: row.action,
          userId: row.userId,
          problemId: row.problemId,
          oldScore: row.oldScore,
          newScore: row.newScore,
          oldReason: row.oldReason,
          newReason: row.newReason,
        },
      })),
    );

  const rejudgeP: Promise<RejudgeAuditEvent[]> = submissionRepo
    .listIdsForContext(context)
    .then((ids) => submissionRejudgeLogRepo.listForSubmissionIds(ids))
    .then((rows) =>
      rows.map((row) => ({
        at: row.createdAt,
        actorUserId: row.rejudgedByUserId,
        kind: "rejudge" as const,
        detail: {
          submissionId: row.submissionId,
          oldVerdict: row.oldVerdict,
          newVerdict: row.newVerdict,
          oldScore: row.oldScore,
          newScore: row.newScore,
        },
      })),
    );

  const [lifecycle, overrides, rejudges] = await Promise.all([lifecycleP, overrideP, rejudgeP]);

  return [...lifecycle, ...overrides, ...rejudges].sort(
    (a, b) => b.at.getTime() - a.at.getTime(),
  );
}
