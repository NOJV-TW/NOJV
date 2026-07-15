import {
  apiErrorSchema,
  submissionDispatchResponseSchema,
  submissionOperationSchema,
  submissionResultSchema,
  type Language,
  type SubmissionContext,
  type SubmissionResult,
  type SubmissionRunCase,
} from "@nojv/core";

import { fetchWithCsrf } from "$lib/services/http";
import { watchSubmissionVerdict } from "$lib/stores/sse";

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
const INITIAL_POLL_DELAY_MS = 500;
const MAX_POLL_DELAY_MS = 5_000;
const POLL_BACKOFF_FACTOR = 1.5;

export function buildSubmissionBody(request: SubmissionRequest): Record<string, unknown> {
  const commonFields: Record<string, unknown> = {
    context: request.context,
    language: request.language,
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
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const message = typeof body?.message === "string" ? body.message : "Submission failed.";
    const code = typeof body?.code === "string" ? body.code : null;
    const retryAfterSec = typeof body?.retryAfterSec === "number" ? body.retryAfterSec : null;
    throw new SubmissionRequestError(message, code, retryAfterSec);
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

  const verdictSignal = createVerdictSignal(dispatch.submissionId);

  try {
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

      const wokeEarly = await waitForPollTick(pollDelay, verdictSignal.promise, signal);
      if (signal?.aborted) return null;
      pollDelay = wokeEarly
        ? INITIAL_POLL_DELAY_MS
        : Math.min(pollDelay * POLL_BACKOFF_FACTOR, MAX_POLL_DELAY_MS);
    }

    return null;
  } finally {
    verdictSignal.dispose();
  }
}

interface VerdictSignal {
  promise: Promise<void>;
  dispose: () => void;
}

function createVerdictSignal(submissionId: string): VerdictSignal {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  const unsubscribe = watchSubmissionVerdict(submissionId, () => {
    resolve();
  });
  return {
    promise,
    dispose: unsubscribe,
  };
}

async function waitForPollTick(
  ms: number,
  verdictPromise: Promise<void>,
  signal?: AbortSignal,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  const result = await Promise.race([timeoutPromise, verdictPromise.then(() => true)]);
  if (timer) clearTimeout(timer);
  return result;
}
