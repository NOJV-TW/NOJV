import {
  assessmentAuditLogRepo,
  scoreOverrideAuditLogRepo,
  submissionRejudgeLogRepo,
  submissionRepo,
} from "@nojv/db";

import type { GradableContext } from "../shared/context-window";

export type AuditEventKind = "lifecycle" | "score_override" | "rejudge";

// Source-row types derived from the repo return shapes rather than imported
// from `generated/prisma/enums` — keeps `detail` field types (e.g. the
// `action` enums) compile-checked against the DB without the domain layer
// reaching into generated Prisma artifacts.
type LifecycleRow = Awaited<ReturnType<typeof assessmentAuditLogRepo.listByAssessment>>[number];
type ScoreOverrideRow = Awaited<
  ReturnType<typeof scoreOverrideAuditLogRepo.listForContext>
>[number];
type RejudgeRow = Awaited<
  ReturnType<typeof submissionRejudgeLogRepo.listForSubmissionIds>
>[number];

/** Fields common to every audit event regardless of source. */
interface AuditEventBase {
  at: Date;
  actorUserId: string | null;
}

/** Assignment lifecycle transition (publish / revert-to-draft / delete-draft). */
export interface LifecycleAuditEvent extends AuditEventBase {
  kind: "lifecycle";
  detail: { action: LifecycleRow["action"] };
}

/** Score-override create / update / delete on a student's problem score. */
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

/** A submission rejudge — result-JSON blobs are deliberately omitted. */
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

/**
 * One normalized row in a context's audit timeline. The three source
 * tables (`AssessmentAuditLog`, `ScoreOverrideAuditLog`,
 * `SubmissionRejudgeLog`) have unrelated shapes — they are flattened
 * into this discriminated union so the timeline UI can `switch` on
 * `kind` with exhaustive, compile-checked `detail` narrowing.
 */
export type AuditEvent = LifecycleAuditEvent | ScoreOverrideAuditEvent | RejudgeAuditEvent;

/**
 * Read-only merged audit timeline for one gradable context, newest
 * first. Assignments draw from all three sources; exams and contests
 * have no lifecycle audit log, so their timelines omit lifecycle
 * events. Callers are responsible for the staff permission gate.
 */
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
