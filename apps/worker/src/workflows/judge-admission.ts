import {
  condition,
  allHandlersFinished,
  defineUpdate,
  startChild,
  ParentClosePolicy,
  isCancellation,
  continueAsNew,
  defineQuery,
  defineSignal,
  getExternalWorkflowHandle,
  log,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import {
  compactAdmissionState,
  admitAvailable,
  cancelQueuedRun,
  confirmPermitCleanup,
  createAdmissionState,
  enqueueAdmission,
  finishAdmissionRun,
  registerAdmissionRun,
  updateCapacitySnapshot,
  type JudgeAdmissionRequest,
  type JudgeAdmissionState,
  type JudgePermit,
  type JudgeRunRegistration,
} from "../services/judge-capacity";
import type { SubmissionJudgeInput, RejudgeInput } from "@nojv/core";
import type * as activities from "../activities/judge-control";

export const JUDGE_ADMISSION_ID = "judge-admission-v1";
export const JUDGE_CONTROL_QUEUE = "judge-control";
export interface AdmissionReply {
  requestId: string;
  permit?: JudgePermit;
  error?: string;
  redirectToLegacy?: boolean;
}
export const requestJudgeAdmission =
  defineSignal<[{ request: JudgeAdmissionRequest; replyTo: string }]>("requestJudgeAdmission");
export const registerJudgeRun =
  defineSignal<[JudgeRunRegistration & { workflowId?: string }]>("registerJudgeRun");
export const reserveJudgeSubmission =
  defineSignal<
    [{ workflowId: string; submissionId: string; studentId: string; submittedAt: number }]
  >("reserveJudgeSubmission");
export const finishJudgeReservation = defineSignal<[string]>("finishJudgeReservation");
export const judgeAdmissionReply = defineSignal<[AdmissionReply]>("judgeAdmissionReply");
export const releaseJudgePermit =
  defineSignal<[{ runId: string; permitId: string }]>("releaseJudgePermit");
export const cleanupJudgeRun = defineSignal<[string]>("cleanupJudgeRun");
export const finishJudgeRun = defineSignal<[string]>("finishJudgeRun");
export const cancelJudgeAdmission = defineSignal<[string]>("cancelJudgeAdmission");
export const pauseJudgeAdmission = defineSignal<[boolean]>("pauseJudgeAdmission");
export const activateJudgeQuota = defineSignal("activateJudgeQuota");
export const relinquishJudgeQuota = defineUpdate("relinquishJudgeQuota");
export const configureJudgeDispatch = defineUpdate<
  undefined,
  [{ route: "legacy" | "capacity" | "hold"; draining: boolean }]
>("configureJudgeDispatch");
export const dispatchJudgeWorkflow = defineUpdate<
  undefined,
  [
    {
      workflowId: string;
      workflowType: "submissionJudgeWorkflow" | "rejudgeWorkflow";
      input: SubmissionJudgeInput | RejudgeInput;
      admissionOrder?: { studentId: string; submittedAt: number };
    },
  ]
>("dispatchJudgeWorkflow");
export const admissionStateQuery = defineQuery<CoordinatorState>("admissionState");

interface CoordinatorState {
  admission: JudgeAdmissionState;
  waiters: Record<string, string>;
  outbox: { replyTo: string; reply: AdmissionReply }[];
  quarantinedNodes: string[];
  paused: boolean;
  quotaManaged: boolean;
  quotaReady: boolean;
  draining: boolean;
  dispatchRoute: "legacy" | "capacity" | "hold";
  activeSubmissionIds: string[];
  activeRejudgeIds: string[];
  stagedWorkflowIds: string[];
  routingInFlight: number;
}
const control = proxyActivities<typeof activities>({
  taskQueue: JUDGE_CONTROL_QUEUE,
  startToCloseTimeout: "25s",
  retry: { maximumAttempts: 1 },
});

export async function judgeAdmissionWorkflow(input?: CoordinatorState): Promise<never> {
  const state: CoordinatorState = input ?? {
    admission: createAdmissionState(),
    waiters: {},
    outbox: [],
    quarantinedNodes: [],
    paused: true,
    quotaManaged: false,
    quotaReady: false,
    draining: false,
    dispatchRoute: "legacy",
    activeSubmissionIds: [],
    activeRejudgeIds: [],
    stagedWorkflowIds: [],
    routingInFlight: 0,
  };
  let changed = true;
  let refreshInFlight = false;
  let relinquishingQuota = false;
  setHandler(
    relinquishJudgeQuota,
    async () => {
      relinquishingQuota = true;
      state.paused = true;
      state.quotaManaged = false;
      await condition(() => !refreshInFlight);
      state.quotaReady = false;
      relinquishingQuota = false;
      changed = true;
    },
    {
      validator: () => {
        if (
          state.dispatchRoute !== "legacy" ||
          !state.draining ||
          state.routingInFlight !== 0 ||
          state.activeSubmissionIds.length > 0 ||
          state.activeRejudgeIds.length > 0 ||
          state.admission.pending.length > 0 ||
          state.admission.permits.some((permit) => !permit.cleanupConfirmed)
        )
          throw new Error("Quota ownership can only be relinquished after rollback drain");
      },
    },
  );
  const reserve = (registration: {
    workflowId: string;
    submissionId: string;
    studentId: string;
    submittedAt: number;
  }) => {
    const runId = `dispatch/${registration.workflowId}`;
    if (state.admission.runs.some((run) => run.runId === runId)) return;
    registerAdmissionRun(state.admission, {
      runId,
      submissionId: registration.submissionId,
      studentId: registration.studentId,
      submittedAt: registration.submittedAt,
      createdAt: Date.now(),
    });
    changed = true;
  };
  setHandler(reserveJudgeSubmission, reserve);
  setHandler(finishJudgeReservation, (workflowId) => {
    finishAdmissionRun(state.admission, `dispatch/${workflowId}`, true);
    changed = true;
  });

  setHandler(
    configureJudgeDispatch,
    ({ route, draining }) => {
      state.dispatchRoute = route;
      state.draining = draining;
      changed = true;
      return undefined;
    },
    {
      validator: ({ route, draining }) => {
        if (relinquishingQuota) throw new Error("Quota relinquishment is in progress");
        if (
          (route !== "legacy" && route !== "capacity" && route !== "hold") ||
          typeof draining !== "boolean"
        )
          throw new Error("Invalid judge dispatch configuration");
        if (
          route === "hold" &&
          (!state.paused || state.activeSubmissionIds.length > 0 || !draining)
        )
          throw new Error(
            "Holding accepted work requires paused admission with no active submissions",
          );
        if (draining && state.activeRejudgeIds.length > 0)
          throw new Error("Finish active rejudge batches before draining");
        if (
          route === "capacity" &&
          (!state.quotaReady ||
            state.paused ||
            !state.admission.snapshot ||
            Date.now() - state.admission.snapshot.observedAt > 90_000 ||
            Date.now() < state.admission.snapshot.observedAt)
        )
          throw new Error(
            "Capacity quota and admission must be ready before routing submissions",
          );
        if (route === "legacy" && !draining)
          throw new Error("Legacy routing requires draining staged submissions");
      },
    },
  );
  setHandler(
    dispatchJudgeWorkflow,
    async ({ workflowId, workflowType, input, admissionOrder }) => {
      const taskQueue = state.dispatchRoute === "legacy" ? "judge" : "judge-capacity-v1";
      if (
        taskQueue === "judge-capacity-v1" &&
        workflowType === "submissionJudgeWorkflow" &&
        admissionOrder
      )
        reserve({
          workflowId,
          submissionId: (input as SubmissionJudgeInput).submissionId,
          ...admissionOrder,
        });
      state.routingInFlight++;
      if (taskQueue === "judge-capacity-v1" && !state.stagedWorkflowIds.includes(workflowId))
        state.stagedWorkflowIds.push(workflowId);
      const trackedRejudge =
        workflowType === "rejudgeWorkflow" &&
        taskQueue === "judge-capacity-v1" &&
        !state.activeRejudgeIds.includes(workflowId);
      if (trackedRejudge) state.activeRejudgeIds.push(workflowId);
      try {
        const child = await startChild(workflowType, {
          workflowId,
          taskQueue,
          args: [input],
          workflowIdReusePolicy: "REJECT_DUPLICATE",
          parentClosePolicy: ParentClosePolicy.ABANDON,
          ...(workflowType === "rejudgeWorkflow"
            ? { memo: { triggeredByUserId: (input as RejudgeInput).triggeredByUserId } }
            : {}),
        });
        if (workflowType === "rejudgeWorkflow" && taskQueue === "judge-capacity-v1") {
          void child.result().then(
            () => {
              state.activeRejudgeIds = state.activeRejudgeIds.filter((id) => id !== workflowId);
              changed = true;
            },
            () => {
              state.activeRejudgeIds = state.activeRejudgeIds.filter((id) => id !== workflowId);
              changed = true;
            },
          );
        }
      } catch (error) {
        if (trackedRejudge)
          state.activeRejudgeIds = state.activeRejudgeIds.filter((id) => id !== workflowId);
        if (
          !(error instanceof Error) ||
          error.name !== "WorkflowExecutionAlreadyStartedError"
        ) {
          if (!isCancellation(error)) {
            finishAdmissionRun(state.admission, `dispatch/${workflowId}`, true);
            state.stagedWorkflowIds = state.stagedWorkflowIds.filter((id) => id !== workflowId);
          }
          throw error;
        }
      } finally {
        state.routingInFlight--;
        changed = true;
      }
      return undefined;
    },
    {
      validator: ({
        workflowId,
        workflowType,
        input,
        admissionOrder,
      }: {
        workflowId: string;
        workflowType: string;
        input?: SubmissionJudgeInput | RejudgeInput;
        admissionOrder?: { studentId: string; submittedAt: number };
      }) => {
        if (
          !workflowId ||
          !input ||
          (workflowType !== "submissionJudgeWorkflow" && workflowType !== "rejudgeWorkflow")
        )
          throw new Error("Invalid judge workflow dispatch");
        if (
          state.dispatchRoute !== "legacy" &&
          workflowType === "submissionJudgeWorkflow" &&
          (!admissionOrder?.studentId ||
            !Number.isSafeInteger(admissionOrder.submittedAt) ||
            admissionOrder.submittedAt < 0)
        )
          throw new Error("Capacity routing requires persisted submission ordering metadata");
        if (
          workflowType === "submissionJudgeWorkflow" &&
          workflowId !== `judge-${(input as SubmissionJudgeInput).submissionId}`
        )
          throw new Error("Submission workflow identity mismatch");
      },
    },
  );
  let refreshAt = 0;
  setHandler(registerJudgeRun, (registration) => {
    try {
      const workflowId = registration.workflowId;
      const placeholder =
        workflowId && !registration.replacesRunId
          ? state.admission.runs.find(
              (run) => run.runId === `dispatch/${workflowId}` && !run.finished,
            )
          : undefined;
      const previous = registration.replacesRunId
        ? state.admission.runs.find((run) => run.runId === registration.replacesRunId)
        : placeholder;
      registerAdmissionRun(state.admission, {
        ...registration,
        ...(previous ? { submittedAt: previous.submittedAt } : {}),
        ...(placeholder ? { replacesRunId: placeholder.runId } : {}),
      });
    } catch (error) {
      log.warn("Rejected judge run registration", {
        runId: registration.runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    changed = true;
  });
  setHandler(requestJudgeAdmission, ({ request, replyTo }) => {
    try {
      enqueueAdmission(state.admission, request);
    } catch (error) {
      state.outbox.push({
        replyTo,
        reply: {
          requestId: request.requestId,
          error: error instanceof Error ? error.message : "Invalid admission request",
        },
      });
      changed = true;
      return;
    }
    state.waiters[request.requestId] = replyTo;
    const existing = state.admission.permits.find(
      (p) => p.request.requestId === request.requestId,
    );
    const rejected = state.admission.rejected.find(
      (r) => r.request.requestId === request.requestId,
    );
    if (existing && !existing.cleanupConfirmed)
      state.outbox.push({ replyTo, reply: { requestId: request.requestId, permit: existing } });
    if (rejected)
      state.outbox.push({
        replyTo,
        reply: { requestId: request.requestId, error: rejected.reason },
      });
    changed = true;
  });
  setHandler(releaseJudgePermit, ({ runId, permitId }) => {
    confirmPermitCleanup(state.admission, runId, permitId, true);
    changed = true;
  });
  setHandler(cancelJudgeAdmission, (runId) => {
    cancelQueuedRun(state.admission, runId);
    changed = true;
  });
  setHandler(cleanupJudgeRun, (runId) => {
    for (const permit of state.admission.permits.filter((p) => p.request.runId === runId))
      confirmPermitCleanup(state.admission, runId, permit.permitId, true);
    changed = true;
  });
  setHandler(finishJudgeRun, (runId) => {
    const requests = new Set(
      [
        ...state.admission.pending,
        ...state.admission.permits.map((permit) => permit.request),
        ...state.admission.rejected.map((rejected) => rejected.request),
        ...state.admission.cancelled,
      ]
        .filter((request) => request.runId === runId)
        .map((request) => request.requestId),
    );
    const belongsToRun = (requestId: string) =>
      requests.has(requestId) || requestId.startsWith(`${runId}/`);
    for (const permit of state.admission.permits.filter((p) => p.request.runId === runId))
      confirmPermitCleanup(state.admission, runId, permit.permitId, true);
    finishAdmissionRun(state.admission, runId, true);
    state.activeSubmissionIds = state.activeSubmissionIds.filter((id) =>
      state.admission.runs.some((run) => run.orderKey === id && !run.finished),
    );
    state.outbox = state.outbox.filter((item) => !belongsToRun(item.reply.requestId));
    state.waiters = Object.fromEntries(
      Object.entries(state.waiters).filter(([requestId]) => !belongsToRun(requestId)),
    );
    changed = true;
  });
  setHandler(activateJudgeQuota, () => {
    if (relinquishingQuota) return;
    state.quotaManaged = true;
    refreshAt = 0;
    changed = true;
  });
  setHandler(pauseJudgeAdmission, (paused) => {
    if (relinquishingQuota) return;
    state.paused = paused;
    changed = true;
  });
  setHandler(admissionStateQuery, () => state);
  for (;;) {
    changed = false;
    if (Date.now() >= refreshAt) {
      refreshAt = Date.now() + 30_000;
      refreshInFlight = true;
      try {
        const snapshot = await control.refreshJudgeCapacity(
          state.quarantinedNodes,
          state.admission.permits.filter((p) => !p.cleanupConfirmed),
          state.quotaManaged,
          state.admission.pending.length,
        );
        state.quotaReady = snapshot.quotaManaged;
        state.quarantinedNodes = snapshot.quarantinedNodes;
        updateCapacitySnapshot(state.admission, snapshot.capacity);
        if (state.stagedWorkflowIds.length > 0) {
          const closed: string[] = await control.closedJudgeWorkflows(
            state.stagedWorkflowIds.slice(0, 128),
          );
          for (const workflowId of closed)
            finishAdmissionRun(state.admission, `dispatch/${workflowId}`, true);
          state.stagedWorkflowIds = state.stagedWorkflowIds.filter(
            (id) => !closed.includes(id),
          );
        }
      } catch {
        /* A failed refresh never extends the last successful snapshot's lifetime. */
      } finally {
        refreshInFlight = false;
      }
    }
    if (!state.paused && state.quotaReady) {
      if (state.draining && state.dispatchRoute === "legacy") {
        for (const request of [...state.admission.pending]) {
          const run = state.admission.runs.find((entry) => entry.runId === request.runId);
          if (!run || state.activeSubmissionIds.includes(run.orderKey)) continue;
          const replyTo = state.waiters[request.requestId];
          if (replyTo)
            state.outbox.push({
              replyTo,
              reply: { requestId: request.requestId, redirectToLegacy: true },
            });
          cancelQueuedRun(state.admission, request.runId);
        }
      }
      const decisions = admitAvailable(
        state.admission,
        Date.now(),
        state.draining ? new Set(state.activeSubmissionIds) : undefined,
      );
      for (const permit of decisions.granted) {
        const run = state.admission.runs.find((entry) => entry.runId === permit.request.runId);
        if (!run) throw new Error("Granted permit has no registered run");
        if (!state.activeSubmissionIds.includes(run.orderKey))
          state.activeSubmissionIds.push(run.orderKey);
        const replyTo = state.waiters[permit.request.requestId];
        if (replyTo)
          state.outbox.push({
            replyTo,
            reply: { requestId: permit.request.requestId, permit },
          });
      }
      for (const rejected of decisions.rejected) {
        const replyTo = state.waiters[rejected.request.requestId];
        if (replyTo)
          state.outbox.push({
            replyTo,
            reply: { requestId: rejected.request.requestId, error: rejected.reason },
          });
      }
    }
    for (const item of [...state.outbox]) {
      if (!state.outbox.includes(item)) continue;
      try {
        await getExternalWorkflowHandle(item.replyTo).signal(judgeAdmissionReply, item.reply);
        const index = state.outbox.indexOf(item);
        if (index !== -1) state.outbox.splice(index, 1);
      } catch {
        // A missing receiver is not evidence that its sandbox has terminated.
      }
    }
    compactAdmissionState(state.admission, Date.now());
    const liveRequests = new Set(
      state.admission.pending
        .map((r) => r.requestId)
        .concat(state.admission.permits.map((p) => p.request.requestId)),
    );
    state.waiters = Object.fromEntries(
      Object.entries(state.waiters).filter(([key]) => liveRequests.has(key)),
    );
    if (workflowInfo().continueAsNewSuggested && state.activeRejudgeIds.length === 0) {
      await condition(allHandlersFinished);
      await continueAsNew<typeof judgeAdmissionWorkflow>(state);
    }
    await condition(() => changed, Math.max(1, refreshAt - Date.now()));
  }
}
