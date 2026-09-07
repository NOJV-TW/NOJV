import { randomUUID } from "node:crypto";

import type { RejudgeInput, RejudgeProgress, SubmissionJudgeJob } from "@nojv/core";
import { submissionJudgeJobSchema } from "@nojv/core";
import { durableWorkRepo, submissionRepo, type TransactionClient } from "@nojv/db";
import { z } from "zod";

import {
  ForbiddenError,
  IntegrityError,
  NotFoundError,
  ServiceUnavailableError,
} from "../shared/errors";
import type { ActorContext } from "../shared/actor-context";
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
  if (
    !workflowId.startsWith(REJUDGE_WORKFLOW_PREFIX) ||
    workflowId.length > 256 ||
    workflowId !== workflowId.trim()
  ) {
    throw new NotFoundError("Rejudge not found.");
  }
}

type RejudgeActor = Pick<ActorContext, "userId" | "platformRole">;

async function requireRejudge(actor: RejudgeActor, workflowId: string) {
  assertRejudgeWorkflowId(workflowId);
  let work;
  try {
    work = await durableWorkRepo.findByWorkflowId(REJUDGE_DISPATCH_WORK_KIND, workflowId);
  } catch (cause) {
    throw new ServiceUnavailableError("Unable to read rejudge status. Please retry.", {
      cause,
    });
  }
  if (!work) throw new NotFoundError("Rejudge not found.");
  const payload = rejudgeDispatchPayloadSchema.safeParse(work.payload);
  if (!payload.success) {
    throw new IntegrityError(
      `Invalid rejudge dispatch payload for ${workflowId}: ${payload.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  if (actor.platformRole !== "admin" && payload.data.input.triggeredByUserId !== actor.userId) {
    throw new ForbiddenError("Only the rejudge requester or an administrator may access it.");
  }
  return work;
}

async function queryWorkflowProgress(workflowId: string) {
  try {
    return await getDomainOrchestration().queryRejudgeProgress(workflowId);
  } catch (cause) {
    throw new ServiceUnavailableError("Unable to refresh rejudge progress. Please retry.", {
      cause,
    });
  }
}

export async function queryRejudgeProgress(
  actor: RejudgeActor,
  workflowId: string,
): Promise<RejudgeProgress> {
  const work = await requireRejudge(actor, workflowId);
  if (work.attempt === 0 && (work.status === "pending" || work.status === "cancelled")) {
    return {
      status: work.status === "pending" ? "queued" : "cancelled",
      completed: 0,
      total: 0,
    };
  }
  const progress = await queryWorkflowProgress(workflowId);
  if (progress) return progress;
  if (work.status === "pending" || work.status === "leased") {
    return { status: "queued", completed: 0, total: 0 };
  }
  if (work.status === "dead") return { status: "failed", completed: 0, total: 0 };
  throw new NotFoundError("Rejudge workflow is no longer available.");
}

export async function cancelRejudge(
  actor: RejudgeActor,
  workflowId: string,
): Promise<{ status: "requested" | "completed" | "failed" | "cancelled" }> {
  const work = await requireRejudge(actor, workflowId);
  if (work.status === "cancelled" && work.attempt === 0) return { status: "cancelled" };
  if (work.status === "pending" && work.attempt === 0) {
    try {
      const cancelled = await durableWorkRepo.cancelUnattempted({
        kind: REJUDGE_DISPATCH_WORK_KIND,
        dedupeKey: work.dedupeKey,
        now: new Date(),
      });
      if (cancelled) return { status: "cancelled" };
    } catch (cause) {
      throw new ServiceUnavailableError("Unable to cancel the queued rejudge. Please retry.", {
        cause,
      });
    }
  }
  const progress = await queryWorkflowProgress(workflowId);
  if (!progress) {
    if (work.status === "dead") return { status: "failed" };
    if (work.status === "pending" || work.status === "leased") {
      throw new ServiceUnavailableError(
        "Rejudge dispatch is in progress. Please retry cancellation shortly.",
      );
    }
    throw new NotFoundError("Rejudge workflow is no longer available.");
  }
  if (
    progress.status === "completed" ||
    progress.status === "failed" ||
    progress.status === "cancelled"
  ) {
    return { status: progress.status };
  }
  try {
    await getDomainOrchestration().cancelRejudge(workflowId);
  } catch (cause) {
    throw new ServiceUnavailableError("Unable to request rejudge cancellation. Please retry.", {
      cause,
    });
  }
  return { status: "requested" };
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
  const submissions = await submissionRepo.listSystemErrorsForRecovery({
    limit: RECOVERY_BATCH_SIZE,
  });
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
