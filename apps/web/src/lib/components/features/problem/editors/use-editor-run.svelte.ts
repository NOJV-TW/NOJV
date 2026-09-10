import type {
  JudgeConfig,
  JudgeType,
  Language,
  SubmissionContext,
  SubmissionResult,
  SubmissionRunCase,
} from "@nojv/core";
import { m } from "$lib/paraglide/messages.js";
import {
  executeSubmission,
  submissionRequestValidationError,
  SubmissionRequestError,
} from "$lib/services/submission-service";
import { toasts } from "$lib/stores/toast";
import { runBrowserLocally, shouldUseBrowserLocalRun } from "$lib/services/browser-local-run";
import type { ProblemDetail } from "$lib/types";
import {
  buildSubmissionRequest,
  projectRunCasesForRequest,
  projectBrowserSubmission,
  projectSubmittedSource,
  type WorkspaceFile,
} from "./editor-bindings";

interface EditorRunArgs {
  problemId: string;
  initialSamples: ProblemDetail["samples"];
  language: () => Language;
  isWorkspaceMode: () => boolean;
  isSpecialEnv: () => boolean;
  judgeType: () => JudgeType;
  judgeConfig: () => JudgeConfig;
  timeLimitMs: number;
  memoryLimitMb: number;
  drafts: () => Record<string, string>;
  workspaceDrafts: () => Record<string, string>;
  workspaceFiles: () => WorkspaceFile[];
  context: () => SubmissionContext;
  onSubmissionDispatched?: ((submissionId: string, language: string) => void) | undefined;
  onSubmissionComplete?:
    | ((
        submissionId: string,
        result: SubmissionResult,
        language: string,
        sourceCode: string,
      ) => void)
    | undefined;
}

export interface EditorRunController {
  readonly isRunning: boolean;
  readonly isSubmitting: boolean;
  readonly bottomTab: "testcase" | "result";
  readonly runResult: SubmissionResult | null;
  readonly runSource: "local" | null;
  readonly runStatus: string | null;
  readonly runError: string | null;
  readonly cooldownUntil: number | null;
  panelRunCases: SubmissionRunCase[];
  setBottomTab: (tab: "testcase" | "result") => void;
  run: () => Promise<void>;
  submit: () => Promise<void>;
  markDestroyed: () => void;
}

export function createEditorRunController(args: EditorRunArgs): EditorRunController {
  let isRunning = $state(false);
  let isSubmitting = $state(false);
  let bottomTab = $state<"testcase" | "result">("testcase");
  let runResult = $state<SubmissionResult | null>(null);
  let runSource = $state<"local" | null>(null);
  let runStatus = $state<string | null>(null);
  let runError = $state<string | null>(null);
  let cooldownUntil = $state<number | null>(null);
  let panelRunCases = $state<SubmissionRunCase[]>(
    args.initialSamples.map((s) => ({ input: s.input, expectedOutput: s.output })),
  );

  let destroyed = false;
  let abortController: AbortController | null = null;
  const inflightSubmits = new Set<AbortController>();

  async function runSubmission(): Promise<SubmissionResult | null> {
    if (args.isSpecialEnv())
      throw new SubmissionRequestError(
        "Client Test requires a browser runtime.",
        "client_test_custom_image",
        null,
      );
    if (args.judgeType() !== "standard")
      throw new SubmissionRequestError(
        "Client Test requires a public judge program.",
        "client_test_private_judge",
        null,
      );

    abortController = new AbortController();
    const { signal } = abortController;

    const runCases = projectRunCasesForRequest(panelRunCases);
    if (runCases.length === 0)
      throw new SubmissionRequestError("No testcases provided.", "invalid_run_cases", null);

    const request = buildSubmissionRequest({
      drafts: args.drafts(),
      isWorkspaceMode: args.isWorkspaceMode(),
      language: args.language(),
      problemId: args.problemId,
      context: args.context(),
      sampleOnly: true,
      workspaceDrafts: args.workspaceDrafts(),
      workspaceFiles: args.workspaceFiles(),
      runCases,
    });

    const validationError = submissionRequestValidationError(request);
    if (validationError)
      throw new SubmissionRequestError("Invalid submission input.", validationError, null);

    if (
      !shouldUseBrowserLocalRun({
        sampleOnly: true,
        specialEnv: false,
        judgeType: "standard",
        language: args.language(),
      })
    )
      throw new SubmissionRequestError(
        "Client runtime is unavailable.",
        "client_test_language",
        null,
      );
    runSource = "local";
    const result = await runBrowserLocally({
      request: projectBrowserSubmission(request, args.workspaceFiles()),
      cases: runCases,
      judgeConfig: args.judgeConfig(),
      problemId: args.problemId,
      timeLimitMs: args.timeLimitMs,
      memoryLimitMb: args.memoryLimitMb,
      signal,
    });
    return destroyed ? null : result;
  }

  async function run() {
    isRunning = true;
    runResult = null;
    runSource = null;
    runStatus = m.editor_running();
    runError = null;
    bottomTab = "result";
    try {
      runResult = await runSubmission();
      runStatus = null;
    } catch (err) {
      const message =
        err instanceof SubmissionRequestError
          ? messageForSubmitError(err.code)
          : m.editor_runFailed();
      runError = message;
      toasts.error(message);
      runStatus = null;
    } finally {
      isRunning = false;
    }
  }

  function messageForSubmitError(code: string | null): string {
    switch (code) {
      case "client_test_custom_image":
        return m.editor_clientTestCustomImage();
      case "client_test_private_judge":
        return m.editor_clientTestPrivateJudge();
      case "client_test_language":
        return m.editor_clientTestLanguage();
      case "invalid_source":
        return m.editor_invalidSource();
      case "invalid_run_cases":
        return m.editor_invalidRunCases();
      case "request_too_large":
        return m.editor_requestTooLarge();
      case "SUBMISSION_TIMEOUT":
        return m.editor_requestTimedOut();
      case "daily_limit":
        return m.submit_error_dailyLimit();
      case "window_closed":
        return m.submit_error_windowClosed();
      case "ip_blocked":
        return m.submit_error_ipBlocked();
      case "language_not_allowed":
        return m.submit_error_languageNotAllowed();
      default:
        return m.editor_submitFailed();
    }
  }

  async function submit() {
    const controller = new AbortController();
    inflightSubmits.add(controller);
    isSubmitting = true;

    const language = args.language();
    const source = projectSubmittedSource({
      drafts: args.drafts(),
      isWorkspaceMode: args.isWorkspaceMode(),
      language,
      workspaceDrafts: args.workspaceDrafts(),
      workspaceFiles: args.workspaceFiles(),
    });

    const request = buildSubmissionRequest({
      drafts: args.drafts(),
      isWorkspaceMode: args.isWorkspaceMode(),
      language,
      problemId: args.problemId,
      context: args.context(),
      sampleOnly: false,
      workspaceDrafts: args.workspaceDrafts(),
      workspaceFiles: args.workspaceFiles(),
    });

    const dispatched: { submissionId: string | null } = { submissionId: null };
    try {
      const validationError = submissionRequestValidationError(request);
      if (validationError)
        throw new SubmissionRequestError("Invalid submission input.", validationError, null);
      const result = await executeSubmission(request, {
        signal: controller.signal,
        onDispatched: (dispatch) => {
          dispatched.submissionId = dispatch.submissionId;
          isSubmitting = false;
          args.onSubmissionDispatched?.(dispatch.submissionId, language);
        },
      });
      if (result && dispatched.submissionId) {
        args.onSubmissionComplete?.(dispatched.submissionId, result, language, source);
      }
    } catch (err) {
      if (
        err instanceof SubmissionRequestError &&
        err.code === "submit_cooldown" &&
        err.retryAfterSec != null &&
        err.retryAfterSec > 0
      ) {
        cooldownUntil = Date.now() + err.retryAfterSec * 1000;
      } else {
        toasts.error(
          err instanceof SubmissionRequestError
            ? messageForSubmitError(err.code)
            : m.editor_submitFailed(),
        );
      }
    } finally {
      isSubmitting = false;
      inflightSubmits.delete(controller);
    }
  }

  return {
    get isRunning() {
      return isRunning;
    },
    get isSubmitting() {
      return isSubmitting;
    },
    get bottomTab() {
      return bottomTab;
    },
    get runResult() {
      return runResult;
    },
    get runSource() {
      return runSource;
    },
    get runStatus() {
      return runStatus;
    },
    get runError() {
      return runError;
    },
    get cooldownUntil() {
      return cooldownUntil;
    },
    get panelRunCases() {
      return panelRunCases;
    },
    set panelRunCases(next) {
      panelRunCases = next;
    },
    setBottomTab(tab) {
      bottomTab = tab;
    },
    run,
    submit,
    markDestroyed() {
      destroyed = true;
      abortController?.abort();
      for (const controller of inflightSubmits) controller.abort();
    },
  };
}
