import { isSubmissionPending, type SubmissionOperation } from "@nojv/core";
import type { ProblemSubmissionEntry } from "$lib/types";
import {
  executeSubmission,
  type ExecuteSubmissionOptions,
  type SubmissionRequest,
} from "./submission-service";
import {
  isNewerSubmission,
  requestSubmissionRefresh,
  watchSubmissionStates,
} from "./submission-tracker";

export async function submitProblem(
  request: SubmissionRequest,
  options: Pick<ExecuteSubmissionOptions, "onDispatched"> = {},
) {
  const result = await executeSubmission(request, {
    onDispatched(dispatch) {
      options.onDispatched?.(dispatch);
      requestSubmissionRefresh();
    },
  });
  requestSubmissionRefresh();
  return result;
}

export function applySubmissionState(
  entry: ProblemSubmissionEntry,
  operation: SubmissionOperation,
): ProblemSubmissionEntry {
  if (!isNewerSubmission(operation, entry)) return entry;
  const current = { ...entry };
  delete current.result;
  return {
    ...current,
    status: operation.status,
    judgeGeneration: operation.judgeGeneration,
    updatedAt: operation.updatedAt,
    ...(!isSubmissionPending(operation.status) && operation.result
      ? { result: operation.result }
      : {}),
  };
}

export function mergeSubmissionEntries(
  current: ProblemSubmissionEntry[],
  incoming: ProblemSubmissionEntry[],
  includeNew = false,
) {
  const updates = new Map(incoming.map((entry) => [entry.id, entry]));
  const merged = current.map((entry) => {
    const next = updates.get(entry.id);
    if (!next || !isNewerSubmission(next, entry)) return entry;
    const old = { ...entry };
    delete old.result;
    if (
      next.judgeGeneration === entry.judgeGeneration &&
      next.updatedAt === entry.updatedAt &&
      next.status === entry.status
    ) {
      return { ...next, ...entry };
    }
    return { ...old, ...next };
  });
  if (includeNew || current.length === 0) {
    const known = new Set(current.map((entry) => entry.id));
    merged.push(...incoming.filter((entry) => !known.has(entry.id)));
    merged.sort(
      (a, b) =>
        b.submittedAt.localeCompare(a.submittedAt) || (b.id ?? "").localeCompare(a.id ?? ""),
    );
  }
  return merged;
}

export const watchProblemSubmissions = watchSubmissionStates;
