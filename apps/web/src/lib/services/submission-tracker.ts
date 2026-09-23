import { invalidate } from "$app/navigation";
import { navigating } from "$app/state";
import {
  isSubmissionOperationActive,
  SSE_SUBMISSION_VERDICT,
  submissionOperationSchema,
  type SubmissionOperation,
  type RejudgeProgress,
} from "@nojv/core";
import { onSSEEvent, onSSEOpen } from "$lib/stores/sse";
import { toasts } from "$lib/stores/toast";
import { formatVerdictLabel } from "$lib/utils/verdict-style";

type Listener = (operation: SubmissionOperation) => void;
type Refresh = (signal: AbortSignal) => Promise<unknown>;
const operations = new Map<string, SubmissionOperation>();
const listeners = new Map<string, Set<Listener>>();
const tracked = new Set<string>();
const notifyIds = new Set<string>();
const refreshers = new Set<Refresh>();
const rejudges = new Map<
  string,
  {
    ids: string[];
    progress?: RejudgeProgress;
    listeners: Set<(progress: RejudgeProgress) => void>;
    errors: Set<() => void>;
  }
>();
let owner: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let active: AbortController | undefined;
let epoch = 0;
let retryMs = 5000;
let rerun = false;
let syncPage = false;
let sessionAbort = new AbortController();
let pageRefreshActive = false;
let pageRetryAt = 0;
let pageRetryDelay = 5000;

function refreshPage() {
  if (navigating.to) {
    syncPage = true;
    return;
  }
  if (pageRefreshActive || Date.now() < pageRetryAt) return;
  pageRefreshActive = true;
  const currentEpoch = epoch;
  let timeout: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("Page refresh timed out")), 10_000);
  });
  void Promise.race([Promise.resolve().then(() => invalidate("submission:data")), deadline])
    .then(() => {
      if (currentEpoch === epoch) {
        pageRetryAt = 0;
        pageRetryDelay = 5000;
      }
    })
    .catch(() => {
      if (currentEpoch !== epoch) return;
      syncPage = true;
      pageRetryAt = Date.now() + pageRetryDelay;
      pageRetryDelay = Math.min(pageRetryDelay * 2, 30_000);
    })
    .finally(() => {
      clearTimeout(timeout);
      if (currentEpoch === epoch) pageRefreshActive = false;
    });
}

export async function submissionRead<T>(url: string, signal?: AbortSignal): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 10_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
    });
    if (!response.ok) throw new Error(`Submission read failed (${String(response.status)})`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function isNewerSubmission(
  incoming: Pick<SubmissionOperation, "judgeGeneration" | "updatedAt">,
  current: Pick<SubmissionOperation, "judgeGeneration" | "updatedAt">,
): boolean {
  return (
    incoming.judgeGeneration > current.judgeGeneration ||
    (incoming.judgeGeneration === current.judgeGeneration &&
      incoming.updatedAt >= current.updatedAt)
  );
}

function publish(operation: SubmissionOperation): boolean {
  const previous = operations.get(operation.submissionId);
  if (previous && !isNewerSubmission(operation, previous)) return false;
  if (
    previous?.judgeGeneration === operation.judgeGeneration &&
    previous.updatedAt === operation.updatedAt &&
    previous.status === operation.status &&
    JSON.stringify(previous.execution) === JSON.stringify(operation.execution)
  ) {
    if (!isSubmissionOperationActive(operation)) {
      tracked.delete(operation.submissionId);
      notifyIds.delete(operation.submissionId);
    }
    return false;
  }
  operations.set(operation.submissionId, operation);
  if (isSubmissionOperationActive(operation)) tracked.add(operation.submissionId);
  else tracked.delete(operation.submissionId);
  for (const listener of listeners.get(operation.submissionId) ?? []) listener(operation);
  if (!isSubmissionOperationActive(operation) && notifyIds.delete(operation.submissionId)) {
    const score = operation.result ? ` · ${String(operation.result.score)}` : "";
    const message = `${operation.problemTitle}: ${formatVerdictLabel(operation.status)}${score}`;
    if (operation.status === "accepted") toasts.success(message);
    else toasts.info(message);
  }
  return true;
}

function schedule(delay = 0) {
  if (typeof window === "undefined") return;
  if (active) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void refresh(), delay);
}

async function discover(signal: AbortSignal, currentEpoch: number) {
  let cursor: string | null = null;
  const found = new Set<string>();
  do {
    const page: { items: unknown[]; nextCursor: string | null } = await submissionRead(
      `/api/submissions/pending${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      signal,
    );
    if (signal.aborted || epoch !== currentEpoch) return found;
    for (const raw of page.items) {
      const operation = submissionOperationSchema.parse(raw);
      notifyIds.add(operation.submissionId);
      found.add(operation.submissionId);
      publish(operation);
    }
    cursor = page.nextCursor;
  } while (cursor);
  return found;
}

async function refresh() {
  timer = undefined;
  if (active || (!owner && !listeners.size && !refreshers.size && !rejudges.size)) return;
  if (document.visibilityState !== "visible") {
    schedule(5000);
    return;
  }
  const controller = new AbortController();
  active = controller;
  const currentEpoch = epoch;
  const signal = controller.signal;
  let changed = syncPage;
  syncPage = false;
  let failed = false;
  try {
    let discovered = new Set<string>();
    if (owner) {
      try {
        discovered = await discover(signal, currentEpoch);
      } catch {
        failed = true;
      }
    }
    const ids = [...new Set([...tracked, ...listeners.keys()])].filter(
      (id) => !discovered.has(id),
    );
    for (let offset = 0; offset < ids.length; offset += 100) {
      try {
        const page = await submissionRead<{ items: unknown[]; unavailableIds: string[] }>(
          `/api/submissions/status?ids=${encodeURIComponent(ids.slice(offset, offset + 100).join(","))}`,
          signal,
        );
        if (signal.aborted || epoch !== currentEpoch) return;
        for (const raw of page.items)
          changed = publish(submissionOperationSchema.parse(raw)) || changed;
        for (const id of page.unavailableIds) {
          tracked.delete(id);
          notifyIds.delete(id);
          operations.delete(id);
        }
      } catch {
        failed = true;
      }
    }
    for (const [id, task] of rejudges) {
      try {
        const progress = await submissionRead<RejudgeProgress>(
          `/api/rejudges/${encodeURIComponent(id)}`,
          signal,
        );
        if (signal.aborted || epoch !== currentEpoch) return;
        task.progress = progress;
        for (const listener of task.listeners) listener(progress);
        if (!["queued", "running"].includes(progress.status)) {
          rejudges.delete(id);
          task.ids.forEach((id) => tracked.add(id));
          changed = true;
          rerun = true;
        }
      } catch {
        failed = true;
        for (const onError of task.errors) onError();
      }
    }
    const results = await Promise.allSettled([...refreshers].map((fn) => fn(signal)));
    failed ||= results.some((result) => result.status === "rejected");
    if ((owner || changed) && !signal.aborted && epoch === currentEpoch) refreshPage();
  } catch {
    failed = true;
  } finally {
    if (active === controller) active = undefined;
    if (epoch === currentEpoch && !signal.aborted) {
      retryMs = failed ? Math.min(retryMs * 2, 30_000) : 5000;
      const delay = rerun ? 0 : retryMs;
      rerun = false;
      schedule(delay);
    }
  }
}

export function requestSubmissionRefresh() {
  syncPage = true;
  if (active) rerun = true;
  else schedule();
}

export function watchSubmissionStates(ids: string[], listener: Listener) {
  for (const id of ids) {
    const current = listeners.get(id) ?? new Set<Listener>();
    current.add(listener);
    listeners.set(id, current);
  }
  queueMicrotask(() => {
    for (const id of ids) {
      const cached = operations.get(id);
      if (cached && listeners.get(id)?.has(listener)) listener(cached);
    }
  });
  schedule();
  return () => {
    for (const id of ids) {
      const current = listeners.get(id);
      current?.delete(listener);
      if (!current?.size) listeners.delete(id);
    }
  };
}

export function onSubmissionRefresh(callback: Refresh) {
  refreshers.add(callback);
  schedule();
  return () => {
    refreshers.delete(callback);
  };
}

export function trackSubmission(id: string) {
  tracked.add(id);
  notifyIds.add(id);
  schedule();
}

export function watchRejudge(
  workflowId: string,
  ids: string[],
  listener: (progress: RejudgeProgress) => void,
  onError?: () => void,
) {
  let task = rejudges.get(workflowId);
  if (!task) {
    task = { ids, listeners: new Set(), errors: new Set() };
    rejudges.set(workflowId, task);
  }
  task.listeners.add(listener);
  if (onError) task.errors.add(onError);
  if (task.progress) listener(task.progress);
  schedule();
  return () => {
    task.listeners.delete(listener);
    if (onError) task.errors.delete(onError);
  };
}

export function startSubmissionTracking(userId: string) {
  stopSubmissionTracking();
  owner = userId;
  const wake = () => {
    if (document.visibilityState === "visible") requestSubmissionRefresh();
  };
  const removeEvent = onSSEEvent(SSE_SUBMISSION_VERDICT, (event) => {
    if (event.type !== SSE_SUBMISSION_VERDICT) return;
    trackSubmission(event.submissionId);
  });
  const removeOpen = onSSEOpen(wake);
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", wake);
  requestSubmissionRefresh();
  return () => {
    removeEvent();
    removeOpen();
    window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", wake);
    stopSubmissionTracking();
  };
}

export function stopSubmissionTracking() {
  epoch++;
  sessionAbort.abort();
  sessionAbort = new AbortController();
  pageRefreshActive = false;
  pageRetryAt = 0;
  pageRetryDelay = 5000;
  active?.abort();
  active = undefined;
  if (timer) clearTimeout(timer);
  timer = undefined;
  owner = null;
  rerun = false;
  syncPage = false;
  retryMs = 5000;
  operations.clear();
  tracked.clear();
  notifyIds.clear();
  rejudges.clear();
}

export function waitForSubmission(
  id: string,
  signal: AbortSignal,
): Promise<SubmissionOperation> {
  trackSubmission(id);
  return new Promise((resolve, reject) => {
    const done = (operation: SubmissionOperation) => {
      if (isSubmissionOperationActive(operation)) return;
      cleanup();
      resolve(operation);
    };
    const release = watchSubmissionStates([id], done);
    const abort = () => {
      cleanup();
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Submission tracking aborted", "AbortError"),
      );
    };
    const cleanup = () => {
      release();
      signal.removeEventListener("abort", abort);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else {
      const current = operations.get(id);
      if (current) done(current);
    }
  });
}

export function getSubmissionState(id: string) {
  return operations.get(id);
}

export function submissionSessionSignal() {
  return sessionAbort.signal;
}
