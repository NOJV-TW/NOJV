import {
  isSubmissionPending,
  submissionOperationStatusSchema,
  type SubmissionOperation,
  type JudgeExecutionView,
} from "@nojv/core";
import { problemRepo, submissionRepo } from "@nojv/db";
import type { ActorContext } from "../shared/actor-context";
import { NotFoundError, ValidationError } from "../shared/errors";
import { getJudgeExecutionViews } from "./judge-execution";
import { canOperateOnSubmission } from "./permissions";
import { getSubmissionForActor, readVerdictDetail } from "./details";
import { queuedRejudges } from "./rejudge-control";
import { submissionSummaryResult, type SubmissionStateRow } from "./operation-state";
import { sanitizeStudentResult } from "./scoring";

export async function applyQueuedRejudges<T extends SubmissionStateRow>(
  rows: T[],
  existing?: Awaited<ReturnType<typeof queuedRejudges>>,
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const queued =
    existing ?? (await queuedRejudges({ submissionIds: rows.map((row) => row.id) }));
  return rows.map((row) => {
    const work = queued.get(row.id);
    return work && !isSubmissionPending(row.status) && work.updatedAt >= row.updatedAt
      ? { ...row, status: work.pending ? "queued" : row.status, updatedAt: work.updatedAt }
      : row;
  });
}

async function authorizeOperation(actor: ActorContext, id: string) {
  try {
    return await getSubmissionForActor(actor, id);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    const candidate = await submissionRepo.findById(id);
    if (
      candidate &&
      !candidate.isReferenceSolution &&
      candidate.userId !== actor.userId &&
      (await canOperateOnSubmission(actor, candidate))
    )
      return candidate;
    throw error;
  }
}

async function operationSummary(
  row: Awaited<ReturnType<typeof authorizeOperation>> & { problem?: { title: string } },
  execution: JudgeExecutionView | null = null,
): Promise<SubmissionOperation> {
  const problem = row.problem ?? (await problemRepo.findById(row.problemId));
  if (!problem) throw new NotFoundError("Submission not found.");
  return {
    submissionId: row.id,
    execution,
    problemId: row.problemId,
    problemTitle: problem.title,
    status: submissionOperationStatusSchema.parse(row.status),
    judgeGeneration: row.judgeGeneration,
    updatedAt: row.updatedAt.toISOString(),
    result: submissionSummaryResult(row),
  };
}

export async function getSubmissionOperation(
  actor: ActorContext,
  id: string,
  includeDetail = false,
  includeStaffFeedback = false,
): Promise<SubmissionOperation> {
  const original = await authorizeOperation(actor, id);
  const [effective] = await applyQueuedRejudges([original]);
  if (!effective) throw new NotFoundError("Submission not found.");
  const executions = await getJudgeExecutionViews([effective]);
  const operation = await operationSummary(effective, executions.get(id) ?? null);
  if (
    !includeDetail ||
    isSubmissionPending(operation.status) ||
    operation.status === "system_error" ||
    !original.verdictDetailStorage
  )
    return operation;
  const detail = await readVerdictDetail(original.verdictDetailStorage);
  const current = await authorizeOperation(actor, id);
  const [latest] = await applyQueuedRejudges([current]);
  if (!latest) throw new NotFoundError("Submission not found.");
  if (
    latest.judgeGeneration !== effective.judgeGeneration ||
    latest.updatedAt.getTime() !== effective.updatedAt.getTime() ||
    latest.status !== effective.status
  )
    return operationSummary(latest, (await getJudgeExecutionViews([latest])).get(id) ?? null);
  return {
    ...operation,
    result:
      detail.verdict === operation.status
        ? includeStaffFeedback
          ? detail
          : sanitizeStudentResult(detail, { sampleOnly: original.sampleOnly })
        : operation.result,
  };
}

export async function listSubmissionOperations(actor: ActorContext, ids: string[]) {
  if (ids.length === 0 || ids.length > 100)
    throw new ValidationError("Between 1 and 100 submission IDs are required.");
  const uniqueIds = [...new Set(ids)];
  const own = await submissionRepo.listByIdsForUserRead({
    ids: uniqueIds,
    userId: actor.userId,
    adminRecovery: actor.platformRole === "admin",
  });
  const available = own.filter((row) => !row.isReferenceSolution);
  const availableIds = new Set(available.map((row) => row.id));
  const remaining = uniqueIds.filter((id) => !availableIds.has(id));
  const candidates = remaining.length
    ? await submissionRepo.listByIdsForStaffRead(remaining)
    : [];
  const contextAccess = new Map<string, Promise<boolean>>();
  for (const row of candidates) {
    if (row.isReferenceSolution) {
      try {
        await getSubmissionForActor(actor, row.id);
        available.push(row);
        availableIds.add(row.id);
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
      }
    } else if (row.userId !== actor.userId) {
      const key = row.contestId
        ? `contest:${row.contestId}`
        : row.assessmentId
          ? `assignment:${row.assessmentId}`
          : row.examId
            ? `exam:${row.examId}`
            : `problem:${row.problemId}`;
      let access = contextAccess.get(key);
      if (!access) {
        access = canOperateOnSubmission(actor, row);
        contextAccess.set(key, access);
      }
      if (await access) {
        available.push(row);
        availableIds.add(row.id);
      }
    }
  }

  const effective = await applyQueuedRejudges(available);
  const executions = await getJudgeExecutionViews(effective);
  return {
    items: await Promise.all(
      effective.map((row) => operationSummary(row, executions.get(row.id) ?? null)),
    ),
    unavailableIds: uniqueIds.filter((id) => !availableIds.has(id)),
  };
}

export async function listPendingSubmissionOperations(actor: ActorContext, cursor?: string) {
  const queued = await queuedRejudges({ userId: actor.userId });
  const rows = await submissionRepo.listPendingForUser({
    userId: actor.userId,
    queuedIds: [...queued].filter(([, work]) => work.pending).map(([id]) => id),
    ...(cursor ? { cursor } : {}),
  });
  if (!rows) throw new ValidationError("Invalid submission cursor.");
  const page = rows.slice(0, 50);
  const visible = [];
  for (const row of page) {
    if (row.isReferenceSolution) {
      try {
        await getSubmissionForActor(actor, row.id);
      } catch (error) {
        if (error instanceof NotFoundError) continue;
        throw error;
      }
    }
    visible.push(row);
  }
  const effective = await applyQueuedRejudges(visible, queued);
  const executions = await getJudgeExecutionViews(effective);
  const authorized = await Promise.all(
    effective.map((row) => operationSummary(row, executions.get(row.id) ?? null)),
  );

  return { items: authorized, nextCursor: rows.length > 50 ? (page.at(-1)?.id ?? null) : null };
}
