import {
  MAX_SUBMISSION_BODY_BYTES,
  submissionDraftSchema,
  submissionDispatchResponseSchema,
  submissionOperationSchema,
  type Language,
  type SubmissionContext,
  type SubmissionResult,
  type SubmissionRunCase,
} from "@nojv/core";

import { fetchWithCsrf } from "$lib/services/http";
import {
  submissionRead,
  waitForSubmission,
  submissionSessionSignal,
} from "$lib/services/submission-tracker";

export interface SubmissionWorkspaceFile {
  path: string;
  content: string;
}

export class SubmissionRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly retryAfterSec: number | null,
  ) {
    super(message);
    this.name = "SubmissionRequestError";
  }
}

export interface SubmissionRequest {
  context: SubmissionContext;
  language: Language;
  problemId: string;
  referenceSolution?: boolean;
  runCases?: SubmissionRunCase[];
  sampleOnly?: boolean;
  sourceCode: string;
  sourceFiles?: SubmissionWorkspaceFile[];
}

export interface ExecuteSubmissionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onDispatched?: (dispatch: ReturnType<typeof submissionDispatchResponseSchema.parse>) => void;
  onOperationUpdate?: (operation: ReturnType<typeof submissionOperationSchema.parse>) => void;
}

const DEFAULT_TIMEOUT_MS = 600_000;

const pendingPosts = new Set<Promise<unknown>>();

export async function waitForPendingSubmissions() {
  await Promise.allSettled(pendingPosts);
}

export function buildSubmissionBody(request: SubmissionRequest): Record<string, unknown> {
  const commonFields: Record<string, unknown> = {
    context: request.context,
    language: request.language,
    problemId: request.problemId,
    ...(request.referenceSolution === true ? { referenceSolution: true } : {}),
    sampleOnly: request.sampleOnly ?? false,
  };

  if (
    request.sampleOnly === true &&
    request.runCases !== undefined &&
    request.runCases.length > 0
  ) {
    commonFields.runCases = request.runCases;
  }

  if (request.sourceFiles && request.sourceFiles.length > 0) {
    return {
      ...commonFields,
      sourceFiles: request.sourceFiles,
    };
  }

  return {
    ...commonFields,
    sourceCode: request.sourceCode,
  };
}

export function submissionRequestValidationError(
  request: SubmissionRequest,
): "invalid_source" | "invalid_run_cases" | "request_too_large" | null {
  const body = buildSubmissionBody(request);
  const parsed = submissionDraftSchema.safeParse(body);
  if (!parsed.success) {
    return parsed.error.issues.some((issue) => issue.path[0] === "runCases")
      ? "invalid_run_cases"
      : "invalid_source";
  }
  return new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_SUBMISSION_BODY_BYTES
    ? "request_too_large"
    : null;
}

async function postSubmission(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ReturnType<typeof submissionDispatchResponseSchema.parse> | null> {
  const postInit: RequestInit = {
    body: JSON.stringify(body),
    method: "POST",
  };
  if (signal) postInit.signal = signal;

  let response: Response;
  try {
    response = await fetchWithCsrf("/api/submissions", postInit);
  } catch (err) {
    if (signal?.aborted) return null;
    throw err;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const message = typeof body?.message === "string" ? body.message : "Submission failed.";
    const code = typeof body?.code === "string" ? body.code : null;
    const retryAfterSec = typeof body?.retryAfterSec === "number" ? body.retryAfterSec : null;
    throw new SubmissionRequestError(message, code, retryAfterSec);
  }

  return submissionDispatchResponseSchema.parse(await response.json());
}

export async function executeSubmission(
  request: SubmissionRequest,
  options: ExecuteSubmissionOptions = {},
): Promise<SubmissionResult | null> {
  const deadline = new AbortController();
  const signal = AbortSignal.any([
    deadline.signal,
    submissionSessionSignal(),
    ...(options.signal ? [options.signal] : []),
  ]);
  const timer = setTimeout(
    () =>
      deadline.abort(
        new SubmissionRequestError(
          "Live updates paused. Your saved submission continues processing; open its submission page for the result.",
          "SUBMISSION_TIMEOUT",
          null,
        ),
      ),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    if (signal.aborted) return null;
    const posting = postSubmission(
      buildSubmissionBody(request),
      AbortSignal.any([deadline.signal, ...(options.signal ? [options.signal] : [])]),
    );
    pendingPosts.add(posting);
    const dispatch = await posting.finally(() => pendingPosts.delete(posting));
    signal.throwIfAborted();
    if (!dispatch) return null;
    options.onDispatched?.(dispatch);
    const operation = await waitForSubmission(dispatch.submissionId, signal);
    options.onOperationUpdate?.(operation);
    try {
      const detail = submissionOperationSchema.parse(
        await submissionRead(dispatch.pollUrl, signal),
      );
      if (
        detail.judgeGeneration === operation.judgeGeneration &&
        detail.status === operation.status
      ) {
        return detail.result ?? operation.result;
      }
    } catch {
      signal.throwIfAborted();
    }
    return operation.result;
  } catch (error) {
    if (options.signal?.aborted) return null;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
