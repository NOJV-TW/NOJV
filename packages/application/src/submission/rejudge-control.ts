import { randomUUID } from "node:crypto";

import type { RejudgeInput, RejudgeProgress, SubmissionJudgeJob } from "@nojv/core";
import { submissionJudgeJobSchema } from "@nojv/core";
import { durableWorkRepo, submissionRepo, type TransactionClient } from "@nojv/db";
import { z } from "zod";

import { ForbiddenError } from "../shared/errors";
import { getDomainOrchestration } from "../shared/orchestration";
import { toJsonValue } from "../shared/to-json-value";

const REJUDGE_WORKFLOW_PREFIX = "rejudge-";
const RECOVERY_BATCH_SIZE = 100;
export const SUBMISSION_JUDGE_DISPATCH_WORK_KIND = "submission.judge.dispatch";
export const REJUDGE_DISPATCH_WORK_KIND = "submission.rejudge.dispatch";

const rejudgeInputSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("single"),
      submissionId: z.string().min(1),
      triggeredByUserId: z.string().min(1).nullable(),
      expectedJudgeGeneration: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("batch"),
      problemId: z.string().min(1),
      contestId: z.string().min(1).optional(),
      assessmentId: z.string().min(1).optional(),
      examId: z.string().min(1).optional(),
      userIds: z.array(z.string().min(1)).optional(),
      since: z.iso.datetime().optional(),
      until: z.iso.datetime().optional(),
      triggeredByUserId: z.string().min(1),
    })
    .strict(),
]);

const rejudgeDispatchPayloadSchema = z
  .object({
    input: rejudgeInputSchema,
    workflowId: z.string().startsWith(REJUDGE_WORKFLOW_PREFIX),
  })
  .strict();

export function assertRejudgeWorkflowId(workflowId: string): void {
  if (!workflowId.startsWith(REJUDGE_WORKFLOW_PREFIX)) {
    throw new ForbiddenError("Not a rejudge workflow.");
  }
}

export async function cancelRejudge(workflowId: string): Promise<void> {
  assertRejudgeWorkflowId(workflowId);
  await getDomainOrchestration().cancelRejudge(workflowId);
}

export async function queryRejudgeProgress(workflowId: string): Promise<RejudgeProgress> {
  assertRejudgeWorkflowId(workflowId);
  return getDomainOrchestration().queryRejudgeProgress(workflowId);
}

export async function getRejudgeTriggeredBy(workflowId: string): Promise<string | null> {
  assertRejudgeWorkflowId(workflowId);
  return getDomainOrchestration().getRejudgeTriggeredBy(workflowId);
}

export async function dispatchRejudge(input: RejudgeInput): Promise<{ workflowId: string }> {
  const workflowId = `${REJUDGE_WORKFLOW_PREFIX}${randomUUID()}`;
  await durableWorkRepo.enqueue({
    kind: REJUDGE_DISPATCH_WORK_KIND,
    dedupeKey: workflowId,
    payload: toJsonValue({ input, workflowId }),
    maxAttempts: 20,
  });
  return { workflowId };
}

export async function recoverSystemErrorSubmissions(): Promise<number> {
  const submissions = await submissionRepo.listSystemErrorsForRecovery();
  for (let offset = 0; offset < submissions.length; offset += RECOVERY_BATCH_SIZE) {
    await durableWorkRepo.enqueueMany(
      submissions.slice(offset, offset + RECOVERY_BATCH_SIZE).map((submission) => {
        const generation = String(submission.judgeGeneration);
        return {
          kind: REJUDGE_DISPATCH_WORK_KIND,
          dedupeKey: `system-error:${submission.id}:${generation}`,
          payload: toJsonValue({
            workflowId: `${REJUDGE_WORKFLOW_PREFIX}system-error-${submission.id}-${generation}`,
            input: {
              mode: "single",
              submissionId: submission.id,
              triggeredByUserId: null,
              expectedJudgeGeneration: submission.judgeGeneration,
            },
          }),
          maxAttempts: 20,
        };
      }),
    );
  }
  return submissions.length;
}

export async function dispatchSubmissionJudge(payload: SubmissionJudgeJob): Promise<void> {
  await enqueueSubmissionJudgeDispatch(undefined, payload);
}

export async function enqueueSubmissionJudgeDispatch(
  tx: TransactionClient | undefined,
  rawPayload: SubmissionJudgeJob,
): Promise<void> {
  const payload = submissionJudgeJobSchema.parse(rawPayload);
  const repo = tx ? durableWorkRepo.withTx(tx) : durableWorkRepo;
  await repo.enqueue({
    kind: SUBMISSION_JUDGE_DISPATCH_WORK_KIND,
    dedupeKey: payload.submissionId,
    payload: toJsonValue(payload),
    maxAttempts: 20,
  });
}

export async function executeSubmissionJudgeDispatch(rawPayload: unknown): Promise<void> {
  const payload = submissionJudgeJobSchema.parse(rawPayload);
  await getDomainOrchestration().dispatchSubmissionJudge(payload);
}

export async function executeRejudgeDispatch(rawPayload: unknown): Promise<void> {
  const parsed = rejudgeDispatchPayloadSchema.parse(rawPayload);
  const input: RejudgeInput =
    parsed.input.mode === "single"
      ? {
          mode: "single",
          submissionId: parsed.input.submissionId,
          triggeredByUserId: parsed.input.triggeredByUserId,
          ...(parsed.input.expectedJudgeGeneration !== undefined
            ? { expectedJudgeGeneration: parsed.input.expectedJudgeGeneration }
            : {}),
        }
      : {
          mode: "batch",
          problemId: parsed.input.problemId,
          triggeredByUserId: parsed.input.triggeredByUserId,
          ...(parsed.input.contestId ? { contestId: parsed.input.contestId } : {}),
          ...(parsed.input.assessmentId ? { assessmentId: parsed.input.assessmentId } : {}),
          ...(parsed.input.examId ? { examId: parsed.input.examId } : {}),
          ...(parsed.input.userIds ? { userIds: parsed.input.userIds } : {}),
          ...(parsed.input.since ? { since: parsed.input.since } : {}),
          ...(parsed.input.until ? { until: parsed.input.until } : {}),
        };
  await getDomainOrchestration().dispatchRejudge(input, parsed.workflowId);
}
