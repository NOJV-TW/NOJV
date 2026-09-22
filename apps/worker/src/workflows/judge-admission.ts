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
  patched,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import {
  assignAdmissionRunPriorities,
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
} from "../services/judge-capacity";
import type { JudgeExecutionInput } from "@nojv/core";
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
export const registerJudgeRun = defineSignal<
  [
    {
      runId: string;
      workflowId: string;
      submissionId: string;
      createdAt: number;
      replacesRunId?: string;
    },
  ]
>("registerJudgeRun");
export const finishJudgeReservation = defineSignal<[string]>("finishJudgeReservation");
export const judgeAdmissionReply = defineSignal<[AdmissionReply]>("judgeAdmissionReply");
export const releaseJudgePermit =
  defineSignal<[{ runId: string; permitId: string }]>("releaseJudgePermit");
export const cleanupJudgeRun = defineSignal<[string]>("cleanupJudgeRun");
export const finishJudgeRun = defineSignal<[string]>("finishJudgeRun");
export const cancelJudgeAdmission = defineSignal<[string]>("cancelJudgeAdmission");
export const pauseJudgeAdmission = defineSignal<[boolean]>("pauseJudgeAdmission");
export const activateJudgeQuota = defineSignal("activateJudgeQuota");
export interface JudgeFifoWait {
  requestId: string;
  executionId: string;
  workflowId: string;
  check: number;
}
export const waitForJudgeFifo = defineSignal<[JudgeFifoWait]>("waitForJudgeFifo");
export const leaveJudgeFifo =
  defineSignal<[{ requestId: string; workflowId: string }]>("leaveJudgeFifo");
export const judgeFifoWake =
  defineSignal<[{ requestId: string; check: number }]>("judgeFifoWake");
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
      workflowType: "durableJudgeWorkflow";
      input: JudgeExecutionInput;
      admissionOrder: {
        studentId: string;
        submittedAt: number;
        submissionId?: string;
        executionId: string;
      };
    },
  ]
>("dispatchJudgeWorkflow");
export const admissionStateQuery = defineQuery<CoordinatorState>("admissionState");
export interface JudgeDispatchState {
  dispatchRoute: "legacy" | "capacity" | "hold";
  draining: boolean;
  active: boolean;
}
export const judgeDispatchStateQuery = defineQuery<JudgeDispatchState, [string]>(
  "judgeDispatchState",
);

interface CoordinatorState {
  admission: JudgeAdmissionState;
  waiters: Record<string, string>;
  runOwners: Record<string, string>;
  fullCleanupConfirmed: string[];
  outbox: { replyTo: string; reply: AdmissionReply }[];
  quarantinedNodes: string[];
  paused: boolean;
  quotaManaged: boolean;
  quotaReady: boolean;
  draining: boolean;
  dispatchRoute: "legacy" | "capacity" | "hold";
  activeSubmissionIds: string[];
  stagedWorkflowIds: string[];
  routingInFlight: number;
  fifoWaiters?: Record<string, JudgeFifoWait & { notified: boolean }>;
  fifoOutbox?: JudgeFifoWait[];
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
    runOwners: {},
    fullCleanupConfirmed: [],
    outbox: [],
    quarantinedNodes: [],
    paused: true,
    quotaManaged: false,
    quotaReady: false,
    draining: false,
    dispatchRoute: "legacy",
    activeSubmissionIds: [],
    stagedWorkflowIds: [],
    routingInFlight: 0,
  };
  let changed = true;
  let refreshInFlight = false;
  let relinquishingQuota = false;
  const fifoWaiters = (state.fifoWaiters ??= {});
  const fifoOutbox = (state.fifoOutbox ??= []);
  let fifoEnabled = false;
  let fifoDirty = true;
  let fifoRefreshAt = 0;
  const removeFifoWaiter = (requestId: string) => {
    Reflect.deleteProperty(fifoWaiters, requestId);
    for (let i = fifoOutbox.length - 1; i >= 0; i--)
      if (fifoOutbox[i]?.requestId === requestId) fifoOutbox.splice(i, 1);
  };
  const retireFifoWaiters = (workflowId: string) => {
    for (const waiter of Object.values(fifoWaiters))
      if (waiter.workflowId === workflowId) removeFifoWaiter(waiter.requestId);
    fifoDirty = true;
  };
  setHandler(waitForJudgeFifo, (waiter) => {
    if (
      !waiter.requestId ||
      !waiter.executionId ||
      !waiter.workflowId.startsWith(`judge-execution-${waiter.executionId}-`) ||
      !Number.isSafeInteger(waiter.check) ||
      waiter.check < 0 ||
      !state.stagedWorkflowIds.includes(waiter.workflowId)
    ) {
      log.warn("Rejected invalid FIFO wait registration");
      return;
    }
    const previous = fifoWaiters[waiter.requestId];
    if (
      previous &&
      (previous.executionId !== waiter.executionId || previous.workflowId !== waiter.workflowId)
    ) {
      log.warn("Rejected changed FIFO wait identity");
      return;
    }
    if (previous && previous.check >= waiter.check) return;
    removeFifoWaiter(waiter.requestId);
    fifoWaiters[waiter.requestId] = { ...waiter, notified: false };
    fifoDirty = true;
    if (fifoEnabled) changed = true;
  });
  setHandler(leaveJudgeFifo, ({ requestId, workflowId }) => {
    if (fifoWaiters[requestId]?.workflowId !== workflowId) return;
    removeFifoWaiter(requestId);
    if (fifoEnabled) changed = true;
  });
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
          state.admission.pending.length > 0 ||
          state.admission.permits.some((permit) => !permit.cleanupConfirmed)
        )
          throw new Error("Quota ownership can only be relinquished after rollback drain");
      },
    },
  );
  const retireInactive = () => {
    state.activeSubmissionIds = state.activeSubmissionIds.filter((id) =>
      state.admission.runs.some((run) => run.orderKey === id && !run.finished),
    );
  };
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
  setHandler(finishJudgeReservation, (workflowId) => {
    retireFifoWaiters(workflowId);
    finishAdmissionRun(state.admission, `dispatch/${workflowId}`, true);
    retireInactive();
    changed = true;
  });

  setHandler(
    configureJudgeDispatch,
    ({ route, draining }) => {
      state.dispatchRoute = route;
      state.draining = draining;
      fifoDirty = true;
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
      const execution = input;
      const forceCapacity =
        execution.capacity ?? state.activeSubmissionIds.includes(execution.executionId);
      const taskQueue =
        forceCapacity || state.dispatchRoute !== "legacy" ? "judge-capacity-v1" : "judge";
      if (forceCapacity && !state.activeSubmissionIds.includes(execution.executionId))
        state.activeSubmissionIds.push(execution.executionId);
      if (taskQueue === "judge-capacity-v1")
        reserve({ workflowId, ...admissionOrder, submissionId: execution.executionId });
      state.routingInFlight++;
      if (taskQueue === "judge-capacity-v1" && !state.stagedWorkflowIds.includes(workflowId))
        state.stagedWorkflowIds.push(workflowId);
      try {
        await startChild(workflowType, {
          workflowId,
          taskQueue,
          args: [taskQueue === "judge-capacity-v1" ? { ...execution, capacity: true } : input],
          workflowIdReusePolicy: "REJECT_DUPLICATE",
          parentClosePolicy: ParentClosePolicy.ABANDON,
        });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.name !== "WorkflowExecutionAlreadyStartedError"
        ) {
          if (!isCancellation(error)) {
            finishAdmissionRun(state.admission, `dispatch/${workflowId}`, true);
            retireInactive();
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
        input?: JudgeExecutionInput;
        admissionOrder?: {
          studentId: string;
          submittedAt: number;
          submissionId?: string;
          executionId: string;
        };
      }) => {
        if (!workflowId || !input || workflowType !== "durableJudgeWorkflow")
          throw new Error("Invalid judge workflow dispatch");
        if (
          !admissionOrder?.studentId ||
          !Number.isSafeInteger(admissionOrder.submittedAt) ||
          admissionOrder.submittedAt < 0
        )
          throw new Error("Capacity routing requires persisted submission ordering metadata");
        if (
          admissionOrder.executionId !== input.executionId ||
          !workflowId.startsWith(`judge-execution-${input.executionId}-`)
        )
          throw new Error("Execution workflow identity mismatch");
      },
    },
  );
  let refreshAt = 0;
  setHandler(registerJudgeRun, (registration) => {
    try {
      const workflowId = registration.workflowId;
      const existing = state.admission.runs.find((run) => run.runId === registration.runId);
      if (existing) {
        if (
          state.runOwners[registration.runId] !== workflowId ||
          existing.orderKey !== registration.submissionId
        )
          throw new Error("Attempt registration identity mismatch");
        state.outbox.push({
          replyTo: workflowId,
          reply: { requestId: `${registration.runId}/register` },
        });
        changed = true;
        return;
      }
      const placeholder = !registration.replacesRunId
        ? state.admission.runs.find(
            (run) => run.runId === `dispatch/${workflowId}` && !run.finished,
          )
        : undefined;
      const previous = registration.replacesRunId
        ? state.admission.runs.find((run) => run.runId === registration.replacesRunId)
        : placeholder;
      if (previous?.orderKey !== registration.submissionId)
        throw new Error("Attempt requires its durable dispatch reservation");
      registerAdmissionRun(state.admission, {
        ...registration,
        studentId: previous.studentId,
        submittedAt: previous.submittedAt,
        ...(placeholder ? { replacesRunId: placeholder.runId } : {}),
      });
      state.runOwners[registration.runId] = workflowId;
      state.outbox.push({
        replyTo: workflowId,
        reply: { requestId: `${registration.runId}/register` },
      });
    } catch (error) {
      state.outbox.push({
        replyTo: registration.workflowId,
        reply: {
          requestId: `${registration.runId}/register`,
          error: error instanceof Error ? error.message : "Registration failed",
        },
      });
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
    if (!state.fullCleanupConfirmed.includes(runId)) state.fullCleanupConfirmed.push(runId);
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
  setHandler(judgeDispatchStateQuery, (executionId) => ({
    dispatchRoute: state.dispatchRoute,
    draining: state.draining,
    active: state.activeSubmissionIds.includes(executionId),
  }));
  for (;;) {
    changed = false;
    fifoEnabled = patched("judge-fifo-wakeup-coordinator-v1");
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
          for (const workflowId of closed) {
            retireFifoWaiters(workflowId);
            finishAdmissionRun(state.admission, `dispatch/${workflowId}`, true);
            for (const run of state.admission.runs) {
              if (
                state.runOwners[run.runId] === workflowId &&
                state.fullCleanupConfirmed.includes(run.runId)
              )
                finishAdmissionRun(state.admission, run.runId, true);
            }
          }
          retireInactive();
          state.stagedWorkflowIds = state.stagedWorkflowIds.filter(
            (id) =>
              !closed.includes(id) ||
              state.admission.runs.some(
                (run) => state.runOwners[run.runId] === id && !run.finished,
              ),
          );
        }
      } catch {
        /* A failed refresh never extends the last successful snapshot's lifetime. */
      } finally {
        refreshInFlight = false;
      }
    }
    if (fifoEnabled && (fifoDirty || Date.now() >= fifoRefreshAt)) {
      fifoDirty = false;
      fifoRefreshAt = Date.now() + 30_000;
      const waiting = Object.values(fifoWaiters).filter((waiter) => !waiter.notified);
      if (waiting.length > 0) {
        try {
          const decisions = await control.resolveJudgeFifoWaiters(
            waiting.map(({ executionId, workflowId }) => ({ executionId, workflowId })),
          );
          const ready = new Set(
            decisions.map(({ executionId, workflowId }) => `${executionId}/${workflowId}`),
          );
          for (const waiter of waiting) {
            const current = fifoWaiters[waiter.requestId];
            if (current?.check !== waiter.check || current.notified) continue;
            const redirect =
              state.draining &&
              state.dispatchRoute === "legacy" &&
              !state.activeSubmissionIds.includes(waiter.executionId);
            if (!redirect && !ready.has(`${waiter.executionId}/${waiter.workflowId}`)) continue;
            current.notified = true;
            fifoOutbox.push(waiter);
          }
        } catch {
          // The durable registrations remain pending for the next reconciliation.
        }
      }
    }
    if (patched("judge-run-priority-v1")) {
      const unresolved = [
        ...new Set(
          state.admission.runs
            .filter((run) => !run.finished && run.priority === undefined)
            .map((run) => run.orderKey),
        ),
      ].slice(0, 256);
      if (unresolved.length > 0) {
        const priorities = await control
          .resolveJudgeRunPriorities(unresolved)
          .catch(() => null);
        if (priorities) assignAdmissionRunPriorities(state.admission, priorities);
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
    if (fifoEnabled)
      for (const waiter of [...fifoOutbox]) {
        if (!fifoOutbox.includes(waiter)) continue;
        try {
          await getExternalWorkflowHandle(waiter.workflowId).signal(judgeFifoWake, {
            requestId: waiter.requestId,
            check: waiter.check,
          });
          const index = fifoOutbox.indexOf(waiter);
          if (index !== -1) fifoOutbox.splice(index, 1);
        } catch {
          // Delivery failure does not establish execution or sandbox termination.
        }
      }
    compactAdmissionState(state.admission, Date.now());
    const knownRuns = new Set(state.admission.runs.map((run) => run.runId));
    state.runOwners = Object.fromEntries(
      Object.entries(state.runOwners).filter(([id]) => knownRuns.has(id)),
    );
    state.fullCleanupConfirmed = state.fullCleanupConfirmed.filter((id) => knownRuns.has(id));
    const liveRequests = new Set(
      state.admission.pending
        .map((r) => r.requestId)
        .concat(state.admission.permits.map((p) => p.request.requestId)),
    );
    state.waiters = Object.fromEntries(
      Object.entries(state.waiters).filter(([key]) => liveRequests.has(key)),
    );
    if (workflowInfo().continueAsNewSuggested) {
      await condition(allHandlersFinished);
      await continueAsNew<typeof judgeAdmissionWorkflow>(state);
    }
    const nextRefresh = fifoEnabled ? Math.min(refreshAt, fifoRefreshAt) : refreshAt;
    await condition(() => changed, Math.max(1, nextRefresh - Date.now()));
  }
}
