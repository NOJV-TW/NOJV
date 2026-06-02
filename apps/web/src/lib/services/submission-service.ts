import {
  apiErrorSchema,
  submissionDispatchResponseSchema,
  submissionOperationSchema,
  submissionResultSchema,
  type Language,
  type SubmissionResult,
  type SubmissionRunCase,
} from "@nojv/core";

import { fetchWithCsrf } from "$lib/services/http";

export interface SubmissionAssessmentContext {
  assessmentId: string;
  courseId: string;
}

export interface SubmissionWorkspaceFile {
  path: string;
  content: string;
}

export interface SubmissionRequest {
  assessment?: SubmissionAssessmentContext | undefined;
  contestId?: string | undefined;
  virtualContestId?: string | undefined;
  language: Language;
  problemId: string;
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

const DEFAULT_TIMEOUT_MS = 30_000;
const INITIAL_POLL_DELAY_MS = 500;
const MAX_POLL_DELAY_MS = 3_000;
const POLL_BACKOFF_FACTOR = 1.5;

function resolveSubmissionMode(
  request: SubmissionRequest,
): "contest" | "assignment" | "practice" | "virtual" {
  if (request.contestId) return "contest";
  if (request.virtualContestId) return "virtual";
  if (request.assessment) return "assignment";
  return "practice";
}

export function buildSubmissionBody(request: SubmissionRequest): Record<string, unknown> {
  const mode = resolveSubmissionMode(request);

  const commonFields: Record<string, unknown> = {
    assessment: request.assessment,
    contestId: request.contestId,
    virtualContestId: request.virtualContestId,
    language: request.language,
    mode,
    problemId: request.problemId,
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
      sourceCode: request.sourceCode,
      sourceFiles: request.sourceFiles,
    };
  }

  return {
    ...commonFields,
    sourceCode: request.sourceCode,
  };
}

type SubmissionOperation = ReturnType<typeof submissionOperationSchema.parse>;

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
    const parsed = apiErrorSchema.safeParse(await response.json());
    throw new Error(parsed.success ? parsed.data.message : "Submission failed.");
  }

  return submissionDispatchResponseSchema.parse(await response.json());
}

async function pollOnce(
  pollUrl: string,
  signal?: AbortSignal,
): Promise<SubmissionOperation | null> {
  const pollInit: RequestInit = { cache: "no-store" };
  if (signal) pollInit.signal = signal;

  let poll: Response;
  try {
    poll = await fetch(pollUrl, pollInit);
  } catch (err) {
    if (signal?.aborted) return null;
    throw err;
  }

  if (!poll.ok) {
    const parsed = apiErrorSchema.safeParse(await poll.json());
    throw new Error(parsed.success ? parsed.data.message : "Polling failed.");
  }

  return submissionOperationSchema.parse(await poll.json());
}

export async function executeSubmission(
  request: SubmissionRequest,
  options: ExecuteSubmissionOptions = {},
): Promise<SubmissionResult | null> {
  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS, onDispatched, onOperationUpdate } = options;

  const body = buildSubmissionBody(request);

  const dispatch = await postSubmission(body, signal);
  if (!dispatch) return null;

  onDispatched?.(dispatch);

  const startedAt = Date.now();
  let pollDelay = INITIAL_POLL_DELAY_MS;

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) return null;

    const operation = await pollOnce(dispatch.pollUrl, signal);
    if (!operation) return null;

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
