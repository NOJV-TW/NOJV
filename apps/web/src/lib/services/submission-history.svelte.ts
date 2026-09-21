import { untrack } from "svelte";
import { isSubmissionPending } from "@nojv/core";
import {
  isNewerSubmission,
  onSubmissionRefresh,
  submissionRead,
  watchSubmissionStates,
} from "./submission-tracker";

interface HistoryRow {
  id: string;
  status: string;
  judgeGeneration?: number;
  updatedAt?: string;
}

export interface SubmissionHistoryPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  snapshot: string;
  newCount: number;
}

export function createSubmissionHistory<T extends HistoryRow>(
  baseQuery: () => string,
  initial: () => T[],
) {
  let items = $state<T[]>(untrack(initial));
  let page = $state(1);
  let totalPages = $state(1);
  let totalCount = $state(untrack(initial).length);
  let newCount = $state(0);
  let loading = $state(false);
  let failed = $state(false);
  let refresh: (() => Promise<void>) | undefined;
  let latest: (() => void) | undefined;
  let requestVersion = 0;

  $effect(() => {
    const base = baseQuery();
    const controller = new AbortController();
    let snapshot: string | undefined;
    let inFlight: AbortController | undefined;
    let initialized = false;
    let stopStates: (() => void) | undefined;
    const observeItems = () => {
      stopStates?.();
      stopStates = watchSubmissionStates(
        items.map((row) => row.id),
        (operation) => {
          if (controller.signal.aborted) return;
          items = items.map((row) => {
            if (row.id !== operation.submissionId) return row;
            if (
              row.judgeGeneration !== undefined &&
              row.updatedAt !== undefined &&
              !isNewerSubmission(operation, {
                judgeGeneration: row.judgeGeneration,
                updatedAt: row.updatedAt,
              })
            )
              return row;
            const pending = isSubmissionPending(operation.status);
            return {
              ...row,
              status: operation.status,
              judgeGeneration: operation.judgeGeneration,
              updatedAt: operation.updatedAt,
              ...("score" in row
                ? { score: pending ? null : (operation.result?.score ?? null) }
                : {}),
              ...("runtimeMs" in row
                ? { runtimeMs: pending ? null : (operation.result?.runtimeMs ?? null) }
                : {}),
              ...("memoryKb" in row
                ? { memoryKb: pending ? null : (operation.result?.memoryKb ?? null) }
                : {}),
            };
          });
        },
      );
    };
    page = 1;
    items = untrack(initial);
    newCount = 0;
    failed = false;
    const load = async (signal?: AbortSignal, background = false) => {
      const isDisposed = () => controller.signal.aborted;
      if (isDisposed()) return;
      if (background && inFlight) return;
      inFlight?.abort();
      const request = new AbortController();
      inFlight = request;
      const version = ++requestVersion;
      const query = new URLSearchParams(base);
      query.set("page", String(page));
      if (snapshot) query.set("snapshot", snapshot);
      loading = true;
      try {
        const signals = [controller.signal, request.signal];
        if (signal) signals.push(signal);
        const result = await submissionRead<SubmissionHistoryPage<T>>(
          `/api/submissions?${query}`,
          AbortSignal.any(signals),
        );
        if (isDisposed() || request.signal.aborted || version !== requestVersion) return;
        if (background && initialized) {
          newCount = result.newCount;
          failed = false;
          return;
        }
        if (page > result.totalPages) {
          page = Math.max(1, result.totalPages);
          snapshot = result.snapshot;
          await load(signal);
          return;
        }
        items = result.items;
        initialized = true;
        observeItems();
        snapshot = result.snapshot;
        totalPages = result.totalPages;
        totalCount = result.totalCount;
        newCount = result.newCount;
        failed = false;
      } catch (error) {
        if (!isDisposed() && !request.signal.aborted && version === requestVersion) {
          failed = true;
          if (background) throw error;
        }
      } finally {
        if (version === requestVersion) {
          loading = false;
          inFlight = undefined;
        }
      }
    };
    refresh = () => load();
    latest = () => {
      snapshot = undefined;
      page = 1;
      void load();
    };
    untrack(observeItems);
    const stop = onSubmissionRefresh((signal) => load(signal, true));
    return () => {
      controller.abort();
      inFlight?.abort();
      stop();
      stopStates?.();
    };
  });

  return {
    get items() {
      return items;
    },
    get page() {
      return page;
    },
    get totalPages() {
      return totalPages;
    },
    get totalCount() {
      return totalCount;
    },
    get newCount() {
      return newCount;
    },
    get loading() {
      return loading;
    },
    get failed() {
      return failed;
    },
    goToPage(target: number) {
      if (loading || target < 1 || target > totalPages || target === page) return;
      page = target;
      void refresh?.();
    },
    showLatest() {
      latest?.();
    },
    retry() {
      void refresh?.();
    },
  };
}
