import {
  ActivityCancellationType,
  CancellationScope,
  condition,
  getExternalWorkflowHandle,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import type { SubmissionJudgeInput } from "@nojv/core";
import type { StorageObjectPointer } from "@nojv/storage";
import type * as activities from "../activities/judge-stages";
import type { WaitForJudgeExecutorRecovery } from "./judge-executor-recovery";
import type { JudgeAdmissionRequest, JudgePermit } from "../services/judge-capacity";
import type { PreparedArtifactReference } from "../services/k8s-executor";
import {
  cancelJudgeAdmission,
  cleanupJudgeRun,
  JUDGE_ADMISSION_ID,
  JUDGE_CONTROL_QUEUE,
  judgeAdmissionReply,
  registerJudgeRun,
  releaseJudgePermit,
  requestJudgeAdmission,
  type AdmissionReply,
} from "./judge-admission";

const stage = proxyActivities<typeof activities>({
  startToCloseTimeout: "10m",
  heartbeatTimeout: "60s",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 1 },
});
const initialization = proxyActivities<typeof activities>({
  startToCloseTimeout: "2m",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 1 },
});
const metadata = proxyActivities<typeof activities>({
  startToCloseTimeout: "2m",
  retry: { maximumAttempts: 3 },
});
const cleanup = proxyActivities<typeof activities>({
  taskQueue: JUDGE_CONTROL_QUEUE,
  startToCloseTimeout: "2m",
  retry: { initialInterval: "5s", maximumInterval: "1m" },
});

export class JudgeRollbackRedirect extends Error {}

export interface JudgeSubmissionOrder {
  studentId: string;
  submittedAt: number;
}

export async function executeCapacityAttempt(
  input: SubmissionJudgeInput,
  runId: string,
  order: JudgeSubmissionOrder,
  waitForExecutorRecovery: WaitForJudgeExecutorRecovery,
  replacesRunId?: string,
) {
  const coordinator = getExternalWorkflowHandle(JUDGE_ADMISSION_ID);
  let sequence = 0;
  const replies = new Map<string, AdmissionReply>();
  setHandler(judgeAdmissionReply, (reply) => {
    replies.set(reply.requestId, reply);
  });
  try {
    await coordinator.signal(registerJudgeRun, {
      runId,
      workflowId: workflowInfo().workflowId,
      submissionId: input.submissionId,
      ...order,
      createdAt: Date.now(),
      ...(replacesRunId ? { replacesRunId } : {}),
    });
    const plan = await initialization
      .initializeSandboxAttempt(input.submissionId, input.draft, runId)
      .catch(async (error: unknown) => {
        await waitForExecutorRecovery(error, { runId, permitId: `${runId}/initialize` });
        throw error;
      });
    if (plan.studentId !== order.studentId)
      throw new Error("Submission student changed after admission registration");
    const permitFor = async (
      key: string,
      phase: JudgeAdmissionRequest["phase"],
      resources: JudgeAdmissionRequest["resources"],
      maximumUnits: number,
      nodeName?: string,
    ): Promise<JudgePermit> => {
      const requestId = `${runId}/${key}`;
      const started = Date.now();
      await coordinator.signal(requestJudgeAdmission, {
        replyTo: workflowInfo().workflowId,
        request: {
          requestId,
          runId,
          sequence: sequence++,
          createdAt: Date.now(),
          studentId: plan.studentId,
          phase,
          resources,
          overhead: plan.overhead,
          maximumUnits,
          ...(nodeName ? { nodeName } : {}),
        },
      });
      await condition(() => replies.has(requestId));
      const reply = replies.get(requestId);
      if (!reply) throw new Error("Admission reply disappeared");
      if (reply.redirectToLegacy)
        throw new JudgeRollbackRedirect("Continue on legacy queue after cleanup");
      if (!reply.permit) throw new Error(reply.error ?? "Admission failed without a permit");
      await metadata.recordAdmissionWait(plan.pointer, Date.now() - started);
      return reply.permit;
    };
    const withPermit = async <T>(permit: JudgePermit, work: () => Promise<T>): Promise<T> => {
      try {
        return await work();
      } catch (error) {
        await waitForExecutorRecovery(error, { runId, permitId: permit.permitId });
        throw error;
      } finally {
        await CancellationScope.nonCancellable(async () => {
          await cleanup.cleanupSandboxStage(runId);
          await coordinator.signal(releaseJudgePermit, { runId, permitId: permit.permitId });
        });
      }
    };
    if (plan.terminal)
      return await metadata.finishSandboxAttempt(plan.pointer, runId, undefined, []);
    let artifact: PreparedArtifactReference | undefined;
    let compilationError: string | undefined;
    const results: StorageObjectPointer[] = [];
    if (plan.mode === "standard" || plan.mode === "checker") {
      const permit = await permitFor("prepare", "prepare", plan.compilerResources, 1);
      const prepared = await withPermit(permit, () =>
        stage.prepareSandboxAttempt(plan.pointer, runId, permit.nodeName),
      );
      artifact = prepared.artifact;
      compilationError = prepared.compilationError;
      if (!artifact && compilationError === undefined)
        throw new Error("Prepare produced no artifact or compilation error");
    }
    if (compilationError === undefined) {
      if (plan.mode === "advanced") {
        const permit = await permitFor("advanced", "other", plan.resources, 1);
        results.push(
          await withPermit(permit, () =>
            stage.executeSandboxWave(plan.pointer, runId, permit.nodeName, []),
          ),
        );
      } else {
        for (let offset = 0; offset < plan.caseIndices.length;) {
          const permit = await permitFor(
            `wave-${String(offset)}`,
            artifact ? "wave" : "other",
            plan.resources,
            artifact ? Math.min(4, plan.caseIndices.length - offset) : 1,
            artifact?.nodeName,
          );
          const indices = plan.caseIndices.slice(offset, offset + permit.units);
          results.push(
            await withPermit(permit, () =>
              stage.executeSandboxWave(plan.pointer, runId, permit.nodeName, indices, artifact),
            ),
          );
          offset += indices.length;
        }
      }
    }
    if (plan.mode === "checker" && compilationError === undefined) {
      const permit = await permitFor("checker", "other", plan.compilerResources, 1);
      return await withPermit(permit, () =>
        stage.finishSandboxAttempt(plan.pointer, runId, permit.nodeName, results),
      );
    }
    return await metadata.finishSandboxAttempt(
      plan.pointer,
      runId,
      undefined,
      results,
      compilationError,
    );
  } finally {
    await CancellationScope.nonCancellable(async () => {
      await coordinator.signal(cancelJudgeAdmission, runId);
      await cleanup.cleanupSandboxAttempt(runId);
      await coordinator.signal(cleanupJudgeRun, runId);
    });
  }
}
