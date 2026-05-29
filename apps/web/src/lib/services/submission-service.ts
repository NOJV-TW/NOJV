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
  onOperationUpdate?: (operation: ReturnType<typeof submissionOperationSchema.parse>) => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const INITIAL_POLL_DELAY_MS = 500;
const MAX_POLL_DELAY_MS = 3_000;
const POLL_BACKOFF_FACTOR = 1.5;

export function buildSubmissionBody(request: SubmissionRequest): Record<string, unknown> {
  const mode: "contest" | "assignment" | "practice" | "virtual" = request.contestId
    ? "contest"
    : request.virtualContestId
      ? "virtual"
      : request.assessment
        ? "assignment"
        : "practice";

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

export async function executeSubmission(
  request: SubmissionRequest,
  options: ExecuteSubmissionOptions = {},
): Promise<SubmissionResult | null> {
  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS, onOperationUpdate } = options;

  const body = buildSubmissionBody(request);

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
