import {
  ApplicationFailure,
  proxyActivities,
  defineQuery,
  setHandler,
  executeChild,
  isCancellation,
  log,
  getExternalWorkflowHandle,
  CancellationScope,
} from "@temporalio/workflow";
import type { RejudgeInput, RejudgeTrackingProgress, SubmissionJudgeDraft } from "@nojv/core";
import type * as judgeActivities from "../activities/judge";
import { submissionJudgeWorkflow } from "./submission-judge";
import { SHORT_ACTIVITY } from "./activity-options";
import {
  JUDGE_ADMISSION_ID,
  reserveJudgeSubmission,
  finishJudgeReservation,
} from "./judge-admission";
import { executeRejudgeBatches, RejudgeBatchError } from "./rejudge-batches";

const judge = proxyActivities<typeof judgeActivities>(SHORT_ACTIVITY);

type RejudgeCounts = Pick<RejudgeTrackingProgress, "completed" | "total" | "targets">;

export const getProgressQuery = defineQuery<RejudgeCounts>("getProgress");

export async function rejudgeWorkflow(input: RejudgeInput): Promise<void> {
  let completed = 0;
  let total = 0;
  let targetSnapshot: Exclude<RejudgeTrackingProgress["targets"], undefined> = null;
  setHandler(getProgressQuery, () => ({
    completed,
    total,
    ...(input.mode === "batch" ? { targets: targetSnapshot } : {}),
  }));

  let targets: {
    submissionId: string;
    draft: SubmissionJudgeDraft;
    studentId?: string;
    staged?: boolean;
  }[];
  if (input.mode === "single") {
    const one = await judge.fetchSingleSubmissionForRejudge(input.submissionId);
    targets = one ? [one] : [];
  } else {
    const selected = await judge.fetchSubmissionIdsForRejudge(input);
    targetSnapshot = selected.map(({ submissionId, judgeGeneration }) => ({
      submissionId,
      judgeGeneration,
    }));
    targets = selected;
  }

  total = targets.length;
  if (total === 0) return;

  const forRejudge = {
    triggeredByUserId: input.triggeredByUserId,
    ...(input.mode === "single" && input.expectedJudgeGeneration !== undefined
      ? { expectedJudgeGeneration: input.expectedJudgeGeneration }
      : {}),
  };

  const reservations = new Map<string, string>();
  const coordinator = getExternalWorkflowHandle(JUDGE_ADMISSION_ID);
  try {
    await executeRejudgeBatches({
      targets,
      batchSize: 10,
      beforeBatch: async (batch) => {
        const submittedAt = Date.now();
        for (const target of batch) {
          if (!target.staged) continue;
          if (!target.studentId)
            throw new Error("Capacity rejudge requires persisted student identity");
          const childId = `rejudge-${target.submissionId}-${String(submittedAt)}`;
          reservations.set(target.submissionId, childId);
          await coordinator.signal(reserveJudgeSubmission, {
            workflowId: childId,
            submissionId: target.submissionId,
            studentId: target.studentId,
            submittedAt,
          });
        }
      },
      execute: async (sub) => {
        await executeChild(submissionJudgeWorkflow, {
          workflowId:
            reservations.get(sub.submissionId) ??
            `rejudge-${sub.submissionId}-${String(Date.now())}`,
          args: [{ submissionId: sub.submissionId, draft: sub.draft, forRejudge }],
        });
      },
      isCancellation,
      onCompleted: () => {
        completed++;
      },
      onFailure: (sub, error) => {
        log.error("rejudge child failed", {
          submissionId: sub.submissionId,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
  } catch (error) {
    if (!(error instanceof RejudgeBatchError)) throw error;
    throw ApplicationFailure.nonRetryable(
      error.message,
      "REJUDGE_CHILD_FAILURE",
      error.failedSubmissionIds,
    );
  } finally {
    await CancellationScope.nonCancellable(async () => {
      for (const childId of reservations.values())
        await coordinator.signal(finishJudgeReservation, childId);
    });
  }
}
