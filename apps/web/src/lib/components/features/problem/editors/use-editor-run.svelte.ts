import type { Language, SubmissionResult } from "@nojv/core";
import { executeSubmission } from "$lib/services/submission-service";
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
  assessment?: (() => { assessmentId: string; courseId: string } | undefined) | undefined;
  contestId?: (() => string | undefined) | undefined;
  participationId?: (() => string | undefined) | undefined;
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
      sampleOnly,
      workspaceDrafts: args.workspaceDrafts(),
      workspaceFiles: args.workspaceFiles(),
      ...(args.assessment?.() ? { assessment: args.assessment() } : {}),
      ...(args.contestId?.() ? { contestId: args.contestId() } : {}),
      ...(args.participationId?.() ? { participationId: args.participationId() } : {}),
      ...(runCases ? { runCases } : {}),
    });

    const result = await executeSubmission(request, { signal });
    return destroyed ? null : result;
  }

  async function run() {
    isRunning = true;
    runResult = null;
    runStatus = "running";
    runError = null;
    bottomTab = "result";
    try {
      runResult = await runSubmission(true);
      runStatus = null;
    } catch (err) {
      runError = err instanceof Error ? err.message : "Run failed.";
      runStatus = null;
    } finally {
      isRunning = false;
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
      sampleOnly: false,
      workspaceDrafts: args.workspaceDrafts(),
      workspaceFiles: args.workspaceFiles(),
      ...(args.assessment?.() ? { assessment: args.assessment() } : {}),
      ...(args.contestId?.() ? { contestId: args.contestId() } : {}),
      ...(args.participationId?.() ? { participationId: args.participationId() } : {}),
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
      runError = err instanceof Error ? err.message : "Submission failed.";
      bottomTab = "result";
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
