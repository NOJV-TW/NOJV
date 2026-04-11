/**
 * Pure-TS submission helper used by the problem editor(s).
 *
 * This module intentionally has **no Svelte imports** so that it can be
 * reused from `Editor.svelte`, `AdvancedModeWorkspace.svelte`, unit tests,
 * or any future surface that needs to dispatch + poll a judge run.
 *
 * Responsibilities:
 *  - Build the submission request payload (single-file vs workspace-file mode).
 *  - POST to `/api/submissions`.
 *  - Poll the returned `pollUrl` until the operation resolves with a result
 *    or until the overall deadline is exceeded.
 *
 * The caller owns lifecycle — pass an `AbortSignal` (usually from an
 * `AbortController` tied to component destroy) and the in-flight fetches +
 * the polling loop will unwind cleanly.
 */

import {
  apiErrorSchema,
  submissionDispatchResponseSchema,
  submissionOperationSchema,
  submissionResultSchema,
  type Language,
  type SubmissionResult
} from "@nojv/core";

export interface SubmissionAssessmentContext {
  assessmentSlug: string;
  courseSlug: string;
}

export interface SubmissionWorkspaceFilePayload {
  path: string;
  content: string;
}

export interface SubmissionRequest {
  assessment?: SubmissionAssessmentContext | undefined;
  contestSlug?: string | undefined;
  language: Language;
  problemId: string;
  sampleOnly?: boolean;
  /** Single-file mode: raw source blob. */
  sourceCode: string;
  /**
   * Workspace-file mode: the full set of non-hidden files for the current
   * language. When supplied, the server merges these with the DB-stored
   * hidden files to rebuild the judge context.
   */
  sourceFiles?: SubmissionWorkspaceFilePayload[];
}

export interface ExecuteSubmissionOptions {
  /**
   * Propagates cancellation to both the POST and every poll request. When
   * aborted (or the caller-observable `destroyed` flag flips) the polling
   * loop resolves with `null` instead of throwing.
   */
  signal?: AbortSignal;
  /**
   * Overall deadline for the polling loop. Defaults to 30 seconds to match
   * the legacy behaviour of `Editor.svelte`.
   */
  timeoutMs?: number;
  /**
   * Optional callback invoked whenever the polling loop has decided to
   * keep waiting. Useful for surfacing intermediate "compiling"/"running"
   * status in the UI without blocking on a specific verdict.
   */
  onOperationUpdate?: (operation: ReturnType<typeof submissionOperationSchema.parse>) => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const INITIAL_POLL_DELAY_MS = 500;
const MAX_POLL_DELAY_MS = 3_000;
const POLL_BACKOFF_FACTOR = 1.5;

/**
 * Build the JSON body sent to `POST /api/submissions`. Extracted so that
 * tests (and any future surface) can assert on the exact shape without
 * running fetch.
 */
export function buildSubmissionBody(request: SubmissionRequest): Record<string, unknown> {
  const mode: "contest" | "assignment" | "practice" = request.contestSlug
    ? "contest"
    : request.assessment
      ? "assignment"
      : "practice";

  const commonFields: Record<string, unknown> = {
    assessment: request.assessment,
    contestSlug: request.contestSlug,
    language: request.language,
    mode,
    problemId: request.problemId,
    // Backward compatibility: some stale backend bundles still validate
    // `problemSlug` as an alias for the problem id.
    problemSlug: request.problemId,
    sampleOnly: request.sampleOnly ?? false
  };

  if (request.sourceFiles && request.sourceFiles.length > 0) {
    return {
      ...commonFields,
      sourceCode: request.sourceCode,
      sourceFiles: request.sourceFiles
    };
  }

  return {
    ...commonFields,
    sourceCode: request.sourceCode
  };
}

/**
 * Dispatch a submission and poll until the judge returns a final verdict.
 *
 * Resolves with the parsed `SubmissionResult` on success, or `null` when
 * the provided signal aborts mid-flight (e.g. the component unmounted).
 * Throws on server errors, parse failures, or overall timeout.
 */
export async function executeSubmission(
  request: SubmissionRequest,
  options: ExecuteSubmissionOptions = {}
): Promise<SubmissionResult | null> {
  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS, onOperationUpdate } = options;

  const body = buildSubmissionBody(request);

  const postInit: RequestInit = {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  };
  if (signal) postInit.signal = signal;

  let response: Response;
  try {
    response = await fetch("/api/submissions", postInit);
  } catch (err) {
    if (signal?.aborted) return null;
    throw err;
  }

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(await response.json());
    throw new Error(parsed.success ? parsed.data.message : "Submission failed.");
  }

  const dispatch = submissionDispatchResponseSchema.parse(await response.json());
  const startedAt = Date.now();
  let pollDelay = INITIAL_POLL_DELAY_MS;

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) return null;

    const pollInit: RequestInit = { cache: "no-store" };
    if (signal) pollInit.signal = signal;

    let poll: Response;
    try {
      poll = await fetch(dispatch.pollUrl, pollInit);
    } catch (err) {
      if (signal?.aborted) return null;
      throw err;
    }

    if (!poll.ok) {
      const parsed = apiErrorSchema.safeParse(await poll.json());
      throw new Error(parsed.success ? parsed.data.message : "Polling failed.");
    }

    const operation = submissionOperationSchema.parse(await poll.json());
    onOperationUpdate?.(operation);

    if (operation.result) {
      return submissionResultSchema.parse(operation.result);
    }

    const delayAborted = await sleep(pollDelay, signal);
    if (delayAborted) return null;
    pollDelay = Math.min(pollDelay * POLL_BACKOFF_FACTOR, MAX_POLL_DELAY_MS);
  }

  throw new Error("Submission polling timed out.");
}

/**
 * Resolves after `ms` milliseconds, or immediately if `signal` aborts.
 * Returns `true` when the sleep was cut short by an abort so callers can
 * unwind without an extra `signal.aborted` check.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(true);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
