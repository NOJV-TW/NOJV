import type { Language, SubmissionContext, SubmissionResult } from "@nojv/core";
import { m } from "$lib/paraglide/messages.js";
import { executeSubmission, SubmissionRequestError } from "$lib/services/submission-service";
import { toasts } from "$lib/stores/toast";
import type { ProblemDetail } from "$lib/types";
import {
  buildSubmissionRequest,
  projectRunCasesForRequest,
  projectSubmittedSource,
  type WorkspaceFile,
} from "./editor-bindings";

interface EditorRunArgs {
  problemId: string;
  initialSamples: ProblemDetail["samples"];
  language: () => Language;
  isWorkspaceMode: () => boolean;
  isSpecialEnv: () => boolean;
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
  readonly runStatus: string | null;
  readonly runError: string | null;
  readonly cooldownUntil: number | null;
  panelRunCases: { input: string; expectedOutput: string }[];
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
  let runStatus = $state<string | null>(null);
  let runError = $state<string | null>(null);
  let cooldownUntil = $state<number | null>(null);
  let panelRunCases = $state<{ input: string; expectedOutput: string }[]>(
    args.initialSamples.map((s) => ({ input: s.input, expectedOutput: s.output })),
  );

  let destroyed = false;
  let abortController: AbortController | null = null;
  const inflightSubmits = new Set<AbortController>();

  async function runSubmission(sampleOnly: boolean): Promise<SubmissionResult | null> {
    abortController = new AbortController();
    const { signal } = abortController;

    const runCases =
      sampleOnly && !args.isSpecialEnv() ? projectRunCasesForRequest(panelRunCases) : undefined;

    const request = buildSubmissionRequest({
      drafts: args.drafts(),
      isWorkspaceMode: args.isWorkspaceMode(),
      language: args.language(),
      problemId: args.problemId,
      context: args.context(),
      sampleOnly,
      workspaceDrafts: args.workspaceDrafts(),
      workspaceFiles: args.workspaceFiles(),
      ...(runCases ? { runCases } : {}),
    });

    const result = await executeSubmission(request, { signal });
    return destroyed ? null : result;
  }

  async function run() {
    isRunning = true;
    runResult = null;
    runStatus = m.editor_running();
    runError = null;
    bottomTab = "result";
    try {
      runResult = await runSubmission(true);
      runStatus = null;
    } catch (err) {
      runError =
        err instanceof SubmissionRequestError
          ? messageForSubmitError(err.code)
          : m.editor_runFailed();
      runStatus = null;
    } finally {
      isRunning = false;
    }
  }

  function messageForSubmitError(code: string | null): string {
    switch (code) {
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
        toasts.add({
          type: "error",
          message:
            err instanceof SubmissionRequestError
              ? messageForSubmitError(err.code)
              : m.editor_submitFailed(),
        });
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
