import type {
  JudgeConfig,
  JudgeType,
  Language,
  SubmissionContext,
  SubmissionResult,
  SubmissionRunCase,
} from "@nojv/core";
import type { BuildArtifact } from "@wasm-oj/browser";
import { serverNow } from "#lib/utils/datetime.js";
import { m } from "#lib/paraglide/messages.js";
import {
  submissionRequestValidationError,
  SubmissionRequestError,
  type SubmissionRequest,
} from "#lib/services/submission-service.js";
import { messageForSubmitError } from "#lib/services/submission-error.js";
import { submitProblem } from "#lib/services/problem-submission.js";
import { toasts } from "#lib/stores/toast.js";
import {
  browserCaseResult,
  browserLocalErrorResult,
  browserLocalSubmissionResult,
  browserToolchainPercent,
  compileBrowserLocally,
  preloadBrowserToolchain,
  runBrowserCases,
  runBrowserChecker,
  runBrowserInteraction,
  runBrowserLocally,
  supportsBrowserLocalRun,
} from "#lib/services/browser-local-run.js";
import type { PreparedJudgeProgram } from "#lib/services/judge-program.js";
import type { ProblemDetail, TestCaseView, TestRunResult } from "#lib/types/index.js";
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
  judgeProgram: () => Promise<PreparedJudgeProgram>;
  onSubmissionDispatched?:
    ((submissionId: string, language: string, submittedAt: string) => void) | undefined;
  onSubmissionComplete?:
    | ((
        submissionId: string,
        result: SubmissionResult,
        language: string,
        sourceCode: string,
        submittedAt: string,
      ) => void)
    | undefined;
}

export interface EditorRunController {
  readonly isRunning: boolean;
  readonly isSubmitting: boolean;
  readonly bottomTab: "testcase" | "result";
  readonly runResult: TestRunResult | null;
  readonly runSource: "local" | null;
  readonly runStatus: string | null;
  readonly submitError: string | null;
  readonly runError: string | null;
  readonly cooldownUntil: number | null;
  panelRunCases: SubmissionRunCase[];
  setBottomTab: (tab: "testcase" | "result") => void;
  run: () => Promise<void>;
  submit: () => Promise<void>;
  markDestroyed: () => void;
}

function initialRunCases(
  samples: ProblemDetail["samples"],
  judgeType: JudgeType,
): SubmissionRunCase[] {
  if (judgeType === "interactive") {
    return samples.flatMap(({ interactorInput }) =>
      interactorInput?.trim() ? [{ input: interactorInput }] : [],
    );
  }
  return samples.map((s) => ({ input: s.input, expectedOutput: s.output }));
}

export function createEditorRunController(args: EditorRunArgs): EditorRunController {
  let isRunning = $state(false);
  let isSubmitting = $state(false);
  let submitError = $state<string | null>(null);
  let bottomTab = $state<"testcase" | "result">("testcase");
  let runResult = $state<TestRunResult | null>(null);
  let runSource = $state<"local" | null>(null);
  let runStatus = $state<string | null>(null);
  let runError = $state<string | null>(null);
  let cooldownUntil = $state<number | null>(null);
  let panelRunCases = $state<SubmissionRunCase[]>(
    initialRunCases(args.initialSamples, args.judgeType()),
  );

  let destroyed = false;
  let abortController: AbortController | null = null;

  function runLimits(language: Language) {
    return {
      language,
      timeLimitMs: args.timeLimitMs,
      memoryLimitMb: args.memoryLimitMb,
      env: args.judgeConfig().runtime?.env ?? {},
    };
  }

  async function runCheckerTest(
    request: SubmissionRequest,
    runCases: SubmissionRunCase[],
    checker: BuildArtifact,
    signal: AbortSignal,
  ): Promise<TestRunResult | null> {
    try {
      const build = await compileBrowserLocally(request, args.problemId, signal);
      if (!build.ok) return build.result;
      const runs = await runBrowserCases(
        build.artifact,
        runCases,
        runLimits(request.language),
        signal,
      );
      const caseResults: TestCaseView[] = [];
      for (const [index, run] of runs.entries()) {
        const view = browserCaseResult(run, undefined, undefined, index);
        const sample =
          run.verdict === "AC"
            ? args.initialSamples.find(
                (candidate) => candidate.input === runCases[index]?.input,
              )
            : undefined;
        if (!sample) {
          caseResults.push(view.verdict === "AC" ? { ...view, executionOnly: true } : view);
          continue;
        }
        const judgement = await runBrowserChecker(
          checker,
          {
            input: sample.input,
            answer: sample.output,
            output: run.stdout,
            timeLimitMs: args.timeLimitMs,
          },
          signal,
        );
        caseResults.push({ ...view, ...judgement, judged: true });
      }
      return { ...browserLocalSubmissionResult(caseResults), caseResults };
    } catch (error) {
      return signal.aborted ? null : browserLocalErrorResult(error);
    }
  }

  async function runInteractiveTest(
    request: SubmissionRequest,
    runCases: SubmissionRunCase[],
    interactor: BuildArtifact,
    signal: AbortSignal,
  ): Promise<TestRunResult | null> {
    try {
      const build = await compileBrowserLocally(request, args.problemId, signal);
      if (!build.ok) return build.result;
      const caseResults: TestCaseView[] = [];
      for (const [index, testCase] of runCases.entries()) {
        const interaction = await runBrowserInteraction(
          build.artifact,
          interactor,
          { interactorInput: testCase.input, limits: runLimits(request.language) },
          signal,
        );
        caseResults.push({ index, ...interaction, judged: true });
      }
      return { ...browserLocalSubmissionResult(caseResults), caseResults };
    } catch (error) {
      return signal.aborted ? null : browserLocalErrorResult(error);
    }
  }

  async function runSubmission(): Promise<TestRunResult | null> {
    if (args.isSpecialEnv())
      throw new SubmissionRequestError(
        "Client Test requires a browser runtime.",
        "client_test_custom_image",
        null,
      );
    const language = args.language();

    abortController = new AbortController();
    const { signal } = abortController;

    const runCases = projectRunCasesForRequest(panelRunCases);
    if (runCases.length === 0)
      throw new SubmissionRequestError("No testcases provided.", "invalid_run_cases", null);

    const request = buildSubmissionRequest({
      drafts: args.drafts(),
      isWorkspaceMode: args.isWorkspaceMode(),
      language,
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

    if (!supportsBrowserLocalRun(language))
      throw new SubmissionRequestError(
        "Client runtime is unavailable.",
        "client_test_language",
        null,
      );
    runSource = "local";
    try {
      await preloadBrowserToolchain(language, (progress) => {
        if (!destroyed) {
          runStatus = m.editor_toolchainDownloading({
            percent: browserToolchainPercent(progress),
          });
        }
      });
    } catch {
      throw new SubmissionRequestError(
        "Browser toolchain unavailable.",
        "browser_toolchain_unavailable",
        null,
      );
    }
    if (signal.aborted) return null;
    const browserRequest = projectBrowserSubmission(request, args.workspaceFiles());
    if (args.judgeType() !== "standard") {
      runStatus =
        args.judgeType() === "interactive"
          ? m.editor_interactorPreparing()
          : m.editor_checkerPreparing();
      const judgeProgram = await args.judgeProgram();
      if (!judgeProgram.ok) return null;
      runStatus = m.editor_running();
      const judged =
        args.judgeType() === "interactive"
          ? await runInteractiveTest(browserRequest, runCases, judgeProgram.artifact, signal)
          : await runCheckerTest(browserRequest, runCases, judgeProgram.artifact, signal);
      return destroyed ? null : judged;
    }
    runStatus = m.editor_running();
    const local = await runBrowserLocally({
      request: browserRequest,
      cases: runCases,
      judgeConfig: args.judgeConfig(),
      problemId: args.problemId,
      timeLimitMs: args.timeLimitMs,
      memoryLimitMb: args.memoryLimitMb,
      signal,
    });
    const result = local && {
      ...local,
      caseResults: local.caseResults?.map((view, index): TestCaseView =>
        view.verdict === "AC" && runCases[index]?.expectedOutput === undefined
          ? { ...view, executionOnly: true }
          : view,
      ),
    };
    return destroyed ? null : result;
  }

  async function run() {
    if (isRunning) return;
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
      if (destroyed) return;
      const message =
        err instanceof SubmissionRequestError
          ? messageForSubmitError(err)
          : m.editor_runFailed();
      runError = message;
      toasts.error(message);
      runStatus = null;
    } finally {
      isRunning = false;
    }
  }

  async function submit() {
    isSubmitting = true;
    submitError = null;

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

    let submissionId: string | undefined;
    let submittedAt: string | undefined;
    try {
      const validationError = submissionRequestValidationError(request);
      if (validationError)
        throw new SubmissionRequestError("Invalid submission input.", validationError, null);
      const result = await submitProblem(request, {
        onDispatched: (dispatch) => {
          submissionId = dispatch.submissionId;
          submittedAt = dispatch.submittedAt;
          if (destroyed) return;
          isSubmitting = false;
          if (dispatch.cooldownSec > 0)
            cooldownUntil = serverNow() + dispatch.cooldownSec * 1000;
          args.onSubmissionDispatched?.(dispatch.submissionId, language, dispatch.submittedAt);
        },
      });
      if (!destroyed && result && submissionId && submittedAt) {
        args.onSubmissionComplete?.(submissionId, result, language, source, submittedAt);
      }
    } catch (err) {
      if (
        err instanceof SubmissionRequestError &&
        err.code === "submit_cooldown" &&
        err.retryAfterSec != null &&
        err.retryAfterSec > 0
      ) {
        cooldownUntil = serverNow() + err.retryAfterSec * 1000;
      }
      if (!destroyed) {
        submitError =
          err instanceof SubmissionRequestError
            ? messageForSubmitError(err)
            : m.editor_submitFailed();
        toasts.error(submitError);
      }
    } finally {
      isSubmitting = false;
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
    get submitError() {
      return submitError;
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
    },
  };
}
