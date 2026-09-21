import {
  ActivityCancellationType,
  ApplicationFailure,
  CancellationScope,
  condition,
  getExternalWorkflowHandle,
  proxyActivities,
  setHandler,
  workflowInfo,
  uuid4,
} from "@temporalio/workflow";
import type { JudgeExecutionInput } from "@nojv/core";
import type * as activities from "../activities/judge-stages";
import type * as controlActivities from "../activities/judge-control";
import type { JudgeAdmissionRequest, JudgePermit } from "../services/judge-capacity";
import type { PreparedArtifactReference } from "../services/k8s-executor";
import { createJudgeExecutorRecovery } from "./judge-executor-recovery";
export class JudgeRollbackRedirect extends Error {}
import {
  JUDGE_ADMISSION_ID,
  JUDGE_CONTROL_QUEUE,
  judgeAdmissionReply,
  registerJudgeRun,
  requestJudgeAdmission,
  releaseJudgePermit,
  cancelJudgeAdmission,
  cleanupJudgeRun,
  finishJudgeRun,
  type AdmissionReply,
} from "./judge-admission";

const stage = proxyActivities<typeof activities>({
  startToCloseTimeout: "70m",
  heartbeatTimeout: "60s",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 1 },
});
const journal = proxyActivities<typeof activities>({
  startToCloseTimeout: "2m",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 3 },
});
const cleanup = proxyActivities<typeof activities>({
  taskQueue: JUDGE_CONTROL_QUEUE,
  startToCloseTimeout: "2m",
  retry: { initialInterval: "5s", maximumInterval: "1m" },
});
const control = proxyActivities<typeof controlActivities>({
  taskQueue: JUDGE_CONTROL_QUEUE,
  startToCloseTimeout: "2m",
  retry: { maximumAttempts: 3 },
});
export interface CapacityWorkflowState {
  runId?: string;
}

export async function executePinnedCapacity(
  input: JudgeExecutionInput,
  state: CapacityWorkflowState,
) {
  const workflowId = workflowInfo().workflowId;
  const coordinator = getExternalWorkflowHandle(JUDGE_ADMISSION_ID);
  const waitForProducer = createJudgeExecutorRecovery();
  const runId = uuid4();
  const lease = { executionId: input.executionId, workflowId, runId };
  const replies = new Map<string, AdmissionReply>();
  setHandler(judgeAdmissionReply, (reply) => {
    replies.set(reply.requestId, reply);
  });
  let claimed = false;
  let sequence = 0;
  try {
    for (;;) {
      const turn = await cleanup.judgeExecutionTurn(input.executionId, workflowId);
      if (turn === "obsolete") return "obsolete" as const;
      if (turn === "redirect")
        throw new JudgeRollbackRedirect("Redirect untouched FIFO waiter");
      if (turn === "ready") break;
      await condition(() => false, "30s");
    }
    await coordinator.signal(registerJudgeRun, {
      runId,
      workflowId,
      submissionId: input.executionId,
      createdAt: Date.now(),
      ...(state.runId ? { replacesRunId: state.runId } : {}),
    });
    const registrationId = `${runId}/register`;
    await condition(() => replies.has(registrationId));
    const registration = replies.get(registrationId);
    if (registration?.error) throw new Error(registration.error);
    state.runId = runId;
    const plan = await stage
      .initializePinnedSandboxAttempt(input.executionId, workflowId, runId)
      .catch(async (error: unknown) => {
        await waitForProducer(error, { runId, permitId: `${runId}/initialize` });
        throw error;
      });
    if (plan.obsolete) return "obsolete" as const;
    const permitFor = async (
      key: string,
      phase: JudgeAdmissionRequest["phase"],
      resources: JudgeAdmissionRequest["resources"],
      maximumUnits: number,
      nodeName?: string,
    ): Promise<JudgePermit> => {
      const requestId = `${runId}/${key}`;
      const waitingSince = Date.now();
      await coordinator.signal(requestJudgeAdmission, {
        replyTo: workflowId,
        request: {
          requestId,
          runId,
          studentId: plan.studentId,
          createdAt: Date.now(),
          sequence: sequence++,
          phase,
          resources,
          overhead: plan.overhead,
          maximumUnits,
          ...(nodeName ? { nodeName } : {}),
        },
      });
      while (!replies.has(requestId)) {
        await condition(() => replies.has(requestId), "30s");
        if (
          claimed &&
          !(await journal.heartbeatPinnedCapacityAttempt(input.executionId, workflowId, runId))
        )
          throw ApplicationFailure.nonRetryable(
            "Execution ownership changed",
            "JudgeExecutionObsolete",
          );
      }
      const reply = replies.get(requestId);
      if (!reply) throw new Error("Admission reply disappeared");
      if (reply.redirectToLegacy) {
        if (claimed || plan.checkpointCount > 0)
          throw new Error(
            "An execution with capacity progress cannot return to the legacy queue",
          );
        throw new JudgeRollbackRedirect("Continue untouched pinned execution on legacy queue");
      }
      if (!reply.permit) throw new Error(reply.error ?? "Admission failed");
      await journal.recordAdmissionWait(plan.pointer, Date.now() - waitingSince);
      if (!claimed) {
        const claim = await journal.claimPinnedCapacityAttempt(
          input.executionId,
          workflowId,
          runId,
        );
        if (claim.status !== "claimed")
          throw ApplicationFailure.nonRetryable(
            "Capacity execution lease is not available",
            "JudgeExecutionObsolete",
          );
        claimed = true;
      }
      return reply.permit;
    };
    const withPermit = async <T>(permit: JudgePermit, run: () => Promise<T>): Promise<T> => {
      try {
        return await run();
      } catch (error) {
        await waitForProducer(error, { runId, permitId: permit.permitId });
        throw error;
      } finally {
        await CancellationScope.nonCancellable(async () => {
          await cleanup.cleanupSandboxStage(runId);
          await coordinator.signal(releaseJudgePermit, { runId, permitId: permit.permitId });
        });
      }
    };
    let artifact: PreparedArtifactReference | undefined;
    let compilationError: string | undefined;
    let checkpoint = plan.checkpointCount;
    const remaining = plan.caseIndices.filter(
      (index) => !plan.completedIndices.includes(index),
    );
    if ((plan.mode === "standard" || plan.mode === "checker") && remaining.length > 0) {
      const permit = await permitFor("prepare", "prepare", plan.compilerResources, 1);
      const prepared = await withPermit(permit, () =>
        stage.prepareSandboxAttempt(plan.pointer, runId, permit.nodeName, lease),
      );
      artifact = prepared.artifact;
      compilationError = prepared.compilationError;
      if (!artifact && compilationError === undefined)
        throw new Error("Prepare produced no artifact or compilation error");
    }
    if (compilationError === undefined) {
      if (plan.mode === "advanced" && checkpoint === 0) {
        const permit = await permitFor("advanced", "other", plan.resources, 1);
        await withPermit(permit, () =>
          stage.executePinnedSandboxWave(
            plan.pointer,
            runId,
            permit.nodeName,
            [],
            checkpoint++,
            lease,
          ),
        );
      } else {
        for (let offset = 0; offset < remaining.length;) {
          const permit = await permitFor(
            `wave-${String(offset)}`,
            artifact ? "wave" : "other",
            plan.resources,
            artifact ? remaining.length - offset : 1,
            artifact?.nodeName,
          );
          const indices = remaining.slice(offset, offset + permit.units);
          await withPermit(permit, () =>
            stage.executePinnedSandboxWave(
              plan.pointer,
              runId,
              permit.nodeName,
              indices,
              checkpoint++,
              lease,
              artifact,
            ),
          );
          offset += indices.length;
        }
      }
    }
    const permit = await permitFor("finalize", "other", plan.compilerResources, 1);
    await withPermit(permit, () =>
      stage.finishPinnedSandboxAttempt(
        plan.pointer,
        runId,
        permit.nodeName,
        lease,
        compilationError,
      ),
    );
    return "finished" as const;
  } finally {
    await CancellationScope.nonCancellable(async () => {
      await coordinator.signal(cancelJudgeAdmission, runId);
      await cleanup.cleanupSandboxAttempt(runId);
      await coordinator.signal(cleanupJudgeRun, runId);
      await cleanup.releasePinnedCapacityAttempt(input.executionId, workflowId, runId);
    });
  }
}

export async function recoverCapacityRuns(
  input: JudgeExecutionInput,
  state: CapacityWorkflowState,
  priorLease: string | null,
) {
  const workflowId = workflowInfo().workflowId;
  const coordinator = getExternalWorkflowHandle(JUDGE_ADMISSION_ID);
  const predecessors = await control.findPriorCapacityRuns(input.executionId, workflowId);
  for (const previous of predecessors) {
    if (previous.cleanupConfirmed) {
      await cleanup.releasePinnedCapacityAttempt(input.executionId, workflowId, previous.runId);
      await coordinator.signal(finishJudgeRun, previous.runId);
    } else await recoverPinnedCapacityLease(input.executionId, workflowId, previous.runId);
    if (state.runId === previous.runId) delete state.runId;
  }
  if (priorLease && !predecessors.some((previous) => previous.runId === priorLease)) {
    await recoverPinnedCapacityLease(input.executionId, workflowId, priorLease);
    if (state.runId === priorLease) delete state.runId;
  }
}

export async function recoverOrphanCapacityRun(input: {
  executionId: string;
  workflowId: string;
  leaseToken: string;
}) {
  const runs = await control.findPriorCapacityRuns(
    input.executionId,
    workflowInfo().workflowId,
  );
  const owned = runs.find(
    (run) => run.runId === input.leaseToken && run.ownerWorkflowId === input.workflowId,
  );
  if (!owned) return;
  if (owned.cleanupConfirmed) {
    await cleanup.releasePinnedCapacityAttempt(
      input.executionId,
      input.workflowId,
      input.leaseToken,
    );
    await getExternalWorkflowHandle(JUDGE_ADMISSION_ID).signal(
      finishJudgeRun,
      input.leaseToken,
    );
  } else
    await recoverPinnedCapacityLease(input.executionId, input.workflowId, input.leaseToken);
}

export async function recoverPinnedCapacityLease(
  executionId: string,
  workflowId: string,
  runId: string,
) {
  const waitForProducer = createJudgeExecutorRecovery();
  await waitForProducer(
    new Error("Recovery must verify the previous executor has stopped"),
    { runId, permitId: `${runId}/recovery` },
    true,
  );
  await CancellationScope.nonCancellable(async () => {
    await cleanup.cleanupSandboxAttempt(runId);
    const coordinator = getExternalWorkflowHandle(JUDGE_ADMISSION_ID);
    await coordinator.signal(cleanupJudgeRun, runId);
    await cleanup.releasePinnedCapacityAttempt(executionId, workflowId, runId);
    await coordinator.signal(finishJudgeRun, runId);
  });
}
