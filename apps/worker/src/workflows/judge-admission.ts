import {
  condition,
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
import type * as activities from "../activities/judge-control";

export const JUDGE_ADMISSION_ID = "judge-admission-v1";
export const JUDGE_CONTROL_QUEUE = "judge-control";
export interface AdmissionReply {
  requestId: string;
  permit?: JudgePermit;
  error?: string;
}
export const requestJudgeAdmission =
  defineSignal<[{ request: JudgeAdmissionRequest; replyTo: string }]>("requestJudgeAdmission");
export const registerJudgeRun = defineSignal<[JudgeRunRegistration]>("registerJudgeRun");
export const judgeAdmissionReply = defineSignal<[AdmissionReply]>("judgeAdmissionReply");
export const releaseJudgePermit =
  defineSignal<[{ runId: string; permitId: string }]>("releaseJudgePermit");
export const cleanupJudgeRun = defineSignal<[string]>("cleanupJudgeRun");
export const finishJudgeRun = defineSignal<[string]>("finishJudgeRun");
export const cancelJudgeAdmission = defineSignal<[string]>("cancelJudgeAdmission");
export const pauseJudgeAdmission = defineSignal<[boolean]>("pauseJudgeAdmission");
export const activateJudgeQuota = defineSignal("activateJudgeQuota");
export const admissionStateQuery = defineQuery<CoordinatorState>("admissionState");

interface CoordinatorState {
  admission: JudgeAdmissionState;
  waiters: Record<string, string>;
  outbox: { replyTo: string; reply: AdmissionReply }[];
  quarantinedNodes: string[];
  paused: boolean;
  quotaManaged: boolean;
  quotaReady: boolean;
}
const control = proxyActivities<typeof activities>({
  taskQueue: JUDGE_CONTROL_QUEUE,
  startToCloseTimeout: "25s",
  retry: { maximumAttempts: 1 },
});

export async function judgeAdmissionWorkflow(input?: CoordinatorState): Promise<never> {
  const state = input ?? {
    admission: createAdmissionState(),
    waiters: {},
    outbox: [],
    quarantinedNodes: [],
    paused: true,
    quotaManaged: false,
    quotaReady: false,
  };
  let changed = true;
  let refreshAt = 0;
  setHandler(registerJudgeRun, (registration) => {
    try {
      registerAdmissionRun(state.admission, registration);
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
    state.outbox = state.outbox.filter((item) => !belongsToRun(item.reply.requestId));
    state.waiters = Object.fromEntries(
      Object.entries(state.waiters).filter(([requestId]) => !belongsToRun(requestId)),
    );
    changed = true;
  });
  setHandler(activateJudgeQuota, () => {
    state.quotaManaged = true;
    refreshAt = 0;
    changed = true;
  });
  setHandler(pauseJudgeAdmission, (paused) => {
    state.paused = paused;
    changed = true;
  });
  setHandler(admissionStateQuery, () => state);
  for (;;) {
    changed = false;
    if (Date.now() >= refreshAt) {
      refreshAt = Date.now() + 30_000;
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
      } catch {
        /* A failed refresh never extends the last successful snapshot's lifetime. */
      }
    }
    if (!state.paused && state.quotaReady) {
      const decisions = admitAvailable(state.admission, Date.now());
      for (const permit of decisions.granted) {
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
    if (workflowInfo().continueAsNewSuggested)
      await continueAsNew<typeof judgeAdmissionWorkflow>(state);
    await condition(() => changed, Math.max(1, refreshAt - Date.now()));
  }
}
