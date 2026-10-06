import {
  MAX_CASE_STDOUT_BYTES,
  interactiveContestantSupported,
  serialiseBuildArtifact,
  type JudgeConfig,
  type JudgeType,
  type Language,
  type SubmissionContext,
  type SubmissionResult,
  type SubmissionRunCase,
  type TestJudgeCaseResult,
} from "@nojv/core";
import { m } from "$lib/paraglide/messages.js";
import {
  requestTestJudge,
  submissionRequestValidationError,
  SubmissionRequestError,
  type SubmissionRequest,
} from "$lib/services/submission-service";
import { submitProblem } from "$lib/services/problem-submission";
import { toasts } from "$lib/stores/toast";
import {
  browserCaseResult,
  browserLocalErrorResult,
  browserLocalSubmissionResult,
  browserToolchainPercent,
  compileBrowserLocally,
  preloadBrowserToolchain,
  runBrowserCases,
  runBrowserLocally,
  shouldUseBrowserLocalRun,
  type BrowserCaseRun,
  type BrowserCompileOutcome,
} from "$lib/services/browser-local-run";
import type { ProblemDetail, TestCaseView, TestRunResult } from "$lib/types";
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
  readonly runResult: TestRunResult | null;
  readonly runSource: "local" | null;
  readonly runStatus: string | null;
  readonly runError: string | null;
  readonly testDisabledReason: string | null;
  readonly customCasesAllowed: boolean;
  readonly cooldownUntil: number | null;
  panelRunCases: SubmissionRunCase[];
  setBottomTab: (tab: "testcase" | "result") => void;
  run: () => Promise<void>;
  submit: () => Promise<void>;
  markDestroyed: () => void;
}

function messageForSubmitError(code: string | null): string {
  switch (code) {
    case "client_test_custom_image":
      return m.editor_clientTestCustomImage();
    case "client_test_language":
      return m.editor_clientTestLanguage();
    case "client_test_interactive_language":
      return m.editor_testInteractiveLanguage();
    case "client_test_no_interactive_samples":
      return m.editor_testNoInteractiveSamples();
    case "test_judge_busy":
      return m.editor_testJudgeBusy();
    case "judge_program_build_failed":
      return m.editor_testJudgeProgramBuildFailed();
    case "test_judge_unavailable":
    case "judge_program_unsupported":
      return m.editor_testUnavailableForProblem();
    case "test_rejected":
      return m.editor_runFailed();
    case "browser_toolchain_unavailable":
      return m.editor_toolchainUnavailable();
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

const TEST_DISABLING_CODES = new Set([
  "judge_program_build_failed",
  "judge_program_unsupported",
]);

function interactiveSampleIndices(samples: ProblemDetail["samples"]): number[] {
  return samples.flatMap((sample, index) => (sample.interactorInput?.trim() ? [index] : []));
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
  let bottomTab = $state<"testcase" | "result">("testcase");
  let runResult = $state<TestRunResult | null>(null);
  let runSource = $state<"local" | null>(null);
  let runStatus = $state<string | null>(null);
  let runError = $state<string | null>(null);
  let testDisabledReason = $state<string | null>(null);
  let cooldownUntil = $state<number | null>(null);
  let panelRunCases = $state<SubmissionRunCase[]>(
    initialRunCases(args.initialSamples, args.judgeType()),
  );

  let destroyed = false;
  let abortController: AbortController | null = null;

  async function runCheckerTest(
    request: SubmissionRequest,
    runCases: SubmissionRunCase[],
    signal: AbortSignal,
  ): Promise<TestRunResult | null> {
    let runs: BrowserCaseRun[];
    try {
      const build = await compileBrowserLocally(request, args.problemId, signal);
      if (!build.ok) return build.result;
      runs = await runBrowserCases(
        build.artifact,
        runCases,
        {
          language: request.language,
          timeLimitMs: args.timeLimitMs,
          memoryLimitMb: args.memoryLimitMb,
          env: args.judgeConfig().runtime?.env ?? {},
        },
        signal,
      );
    } catch (error) {
      return signal.aborted ? null : browserLocalErrorResult(error);
    }
    const judgedCases = new Map<number, number>();
    for (const [index, runCase] of runCases.entries()) {
      const sampleIndex = args.initialSamples.findIndex(
        (sample) => sample.input === runCase.input,
      );
      if (sampleIndex >= 0 && runs[index]?.verdict === "AC" && !judgedCases.has(sampleIndex)) {
        judgedCases.set(sampleIndex, index);
      }
    }
    const judgements = new Map<number, TestJudgeCaseResult>();
    if (judgedCases.size > 0) {
      const response = await requestTestJudge(
        args.problemId,
        {
          kind: "checker",
          context: args.context(),
          cases: [...judgedCases].map(([sampleIndex, index]) => ({
            sampleIndex,
            output: (runs[index]?.stdout ?? "").slice(0, MAX_CASE_STDOUT_BYTES),
          })),
        },
        signal,
      );
      if (!response) return null;
      for (const [position, index] of [...judgedCases.values()].entries()) {
        const judgement = response.cases[position];
        if (judgement) judgements.set(index, judgement);
      }
    }
    const caseResults = runs.map((run, index): TestCaseView => {
      const view = browserCaseResult(run, undefined, undefined, index);
      const judgement = judgements.get(index);
      if (!judgement) return view.verdict === "AC" ? { ...view, executionOnly: true } : view;
      return {
        ...view,
        verdict: judgement.verdict,
        ...(judgement.teamMessage ? { teamMessage: judgement.teamMessage } : {}),
      };
    });
    return { ...browserLocalSubmissionResult(caseResults), caseResults };
  }

  async function runInteractiveTest(
    request: SubmissionRequest,
    sampleIndices: number[],
    signal: AbortSignal,
  ): Promise<TestRunResult | null> {
    let build: BrowserCompileOutcome;
    try {
      build = await compileBrowserLocally(request, args.problemId, signal);
    } catch (error) {
      return signal.aborted ? null : browserLocalErrorResult(error);
    }
    if (!build.ok) return build.result;
    const response = await requestTestJudge(
      args.problemId,
      {
        kind: "interactive",
        context: args.context(),
        language: request.language,
        artifact: serialiseBuildArtifact(build.artifact),
        cases: sampleIndices.map((sampleIndex) => ({ sampleIndex })),
      },
      signal,
    );
    if (!response) return null;
    const caseResults = response.cases.map((judgement, index): TestCaseView => ({
      index,
      verdict: judgement.verdict,
      timeMs: judgement.timeMs ?? 0,
      ...(judgement.contestantStderr ? { stderr: judgement.contestantStderr } : {}),
      ...(judgement.teamMessage ? { teamMessage: judgement.teamMessage } : {}),
      ...(judgement.transcript ? { transcript: judgement.transcript } : {}),
    }));
    return { ...browserLocalSubmissionResult(caseResults), caseResults };
  }

  async function runSubmission(): Promise<TestRunResult | null> {
    if (args.isSpecialEnv())
      throw new SubmissionRequestError(
        "Client Test requires a browser runtime.",
        "client_test_custom_image",
        null,
      );
    const judgeType = args.judgeType();
    const language = args.language();
    const interactive = judgeType === "interactive";
    if (interactive && !interactiveContestantSupported(language))
      throw new SubmissionRequestError(
        "Interactive Test does not support this language.",
        "client_test_interactive_language",
        null,
      );
    const sampleIndices = interactive ? interactiveSampleIndices(args.initialSamples) : [];
    if (interactive && sampleIndices.length === 0)
      throw new SubmissionRequestError(
        "No sample has an interactor input.",
        "client_test_no_interactive_samples",
        null,
      );

    abortController = new AbortController();
    const { signal } = abortController;

    const runCases = interactive ? [] : projectRunCasesForRequest(panelRunCases);
    if (!interactive && runCases.length === 0)
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
      ...(interactive ? {} : { runCases }),
    });

    const validationError = submissionRequestValidationError(request);
    if (validationError)
      throw new SubmissionRequestError("Invalid submission input.", validationError, null);

    if (
      !shouldUseBrowserLocalRun({
        sampleOnly: true,
        specialEnv: false,
        judgeType: "standard",
        language,
      })
    )
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
    runStatus = m.editor_running();
    const browserRequest = projectBrowserSubmission(request, args.workspaceFiles());
    let result: TestRunResult | null;
    if (judgeType === "checker") {
      result = await runCheckerTest(browserRequest, runCases, signal);
    } else if (interactive) {
      result = await runInteractiveTest(browserRequest, sampleIndices, signal);
    } else {
      result = await runBrowserLocally({
        request: browserRequest,
        cases: runCases,
        judgeConfig: args.judgeConfig(),
        problemId: args.problemId,
        timeLimitMs: args.timeLimitMs,
        memoryLimitMb: args.memoryLimitMb,
        signal,
      });
    }
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
      if (err instanceof SubmissionRequestError && TEST_DISABLING_CODES.has(err.code ?? "")) {
        testDisabledReason = message;
      }
      runError = message;
      toasts.error(message);
      runStatus = null;
    } finally {
      isRunning = false;
    }
  }

  async function submit() {
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
      const result = await submitProblem(request, {
        onDispatched: (dispatch) => {
          dispatched.submissionId = dispatch.submissionId;
          if (destroyed) return;
          isSubmitting = false;
          if (dispatch.cooldownSec > 0)
            cooldownUntil = Date.now() + dispatch.cooldownSec * 1000;
          args.onSubmissionDispatched?.(dispatch.submissionId, language);
        },
      });
      if (!destroyed && result && dispatched.submissionId) {
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
    get testDisabledReason() {
      return testDisabledReason;
    },
    get customCasesAllowed() {
      return args.judgeType() !== "interactive";
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
