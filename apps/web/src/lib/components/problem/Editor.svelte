<script lang="ts">
  import { onMount } from "svelte";
  import { locale, t } from "svelte-i18n";
  import {
    submissionDispatchResponseSchema,
    submissionOperationSchema,
    submissionResultSchema,
    supportedLanguages,
    type Language,
    type SubmissionResult
  } from "@nojv/domain";
  import { DEFAULT_LOCALE } from "$lib/i18n";
  import type { ProblemDetail } from "$lib/types";
  import { formatVerdictLabel, verdictColor } from "$lib/types";

  const editorOptions = {
    automaticLayout: true,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 14,
    minimap: { enabled: false },
    padding: { top: 16 },
    scrollBeyondLastLine: false,
    wordWrap: "on" as const
  };

  interface Props {
    assessment?: {
      assessmentSlug: string;
      courseSlug: string;
      kind: "assignment" | "exam";
    };
    contestSlug?: string;
    onSubmissionComplete?: (
      result: SubmissionResult,
      language: string,
      sourceCode: string
    ) => void;
    problem: ProblemDetail;
  }

  let { assessment, contestSlug, onSubmissionComplete, problem }: Props = $props();

  let currentLocale = $derived($locale ?? DEFAULT_LOCALE);
  let isFunctionMode = $derived(problem.submissionType === "function");

  let language = $state<Language>("cpp");
  let drafts = $state({ ...problem.starterByLanguage });
  let isRunning = $state(false);
  let isSubmitting = $state(false);

  // Bottom panel state
  let bottomTab = $state<"testcase" | "result">("testcase");
  let selectedCase = $state(0);
  let selectedResultCase = $state(0);
  let testcases = $state(
    problem.samples.map((s) => ({ input: s.input, expectedOutput: s.output }))
  );
  let runResult = $state<SubmissionResult | null>(null);
  let runStatus = $state<string | null>(null);
  let runError = $state<string | null>(null);

  let currentSource = $derived(drafts[language]);
  let runVerdictLabel = $derived(
    runResult ? formatVerdictLabel(runResult.verdict) : undefined
  );

  // Monaco editor
  let editorContainer: HTMLDivElement;
  let monacoEditor: any;
  let monacoModule: any;

  // Cleanup: abort in-flight polls when component is destroyed
  let destroyed = false;
  let pollAbortController: AbortController | null = null;

  onMount(async () => {
    monacoModule = await import("monaco-editor");
    monacoEditor = monacoModule.editor.create(editorContainer, {
      ...editorOptions,
      language: "cpp",
      theme: "vs-light",
      value: drafts[language]
    });

    monacoEditor.onDidChangeModelContent(() => {
      drafts[language] = monacoEditor.getValue();
    });

    return () => {
      destroyed = true;
      pollAbortController?.abort();
      monacoEditor?.dispose();
    };
  });

  $effect(() => {
    if (monacoEditor && monacoModule) {
      const model = monacoEditor.getModel();
      if (model) {
        const langMap: Record<string, string> = {
          c: "c",
          cpp: "cpp",
          java: "java",
          javascript: "javascript",
          python: "python",
          rust: "rust",
          typescript: "typescript"
        };
        monacoModule.editor.setModelLanguage(model, langMap[language] ?? language);
        monacoEditor.setValue(drafts[language]);
      }
    }
  });

  async function executeSubmission(options?: {
    sampleOnly?: boolean;
  }): Promise<SubmissionResult | null> {
    pollAbortController = new AbortController();
    const { signal } = pollAbortController;

    const response = await fetch("/api/submissions", {
      body: JSON.stringify({
        assessment,
        contestSlug,
        language,
        mode: contestSlug ? "contest" : (assessment?.kind ?? "practice"),
        problemSlug: problem.slug,
        sampleOnly: options?.sampleOnly ?? false,
        sourceCode: drafts[language],
        submissionType: problem.submissionType
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal
    });

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      throw new Error(payload.message ?? "Submission failed.");
    }

    const dispatch = submissionDispatchResponseSchema.parse(await response.json());
    const startedAt = Date.now();

    while (Date.now() - startedAt < 20_000) {
      if (destroyed) return null;

      const poll = await fetch(dispatch.pollUrl, { cache: "no-store", signal });

      if (!poll.ok) {
        const payload = (await poll.json()) as { message?: string };
        throw new Error(payload.message ?? "Polling failed.");
      }

      const operation = submissionOperationSchema.parse(await poll.json());

      if (operation.result) {
        return submissionResultSchema.parse(operation.result);
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 700);
      });
    }

    throw new Error("Submission polling timed out.");
  }

  async function handleRun() {
    isRunning = true;
    runResult = null;
    runStatus = "running";
    runError = null;
    selectedResultCase = 0;
    bottomTab = "result";

    try {
      const result = await executeSubmission({ sampleOnly: true });
      runResult = result;
      runStatus = null;
    } catch (err) {
      runError = err instanceof Error ? err.message : "Run failed.";
      runStatus = null;
    } finally {
      isRunning = false;
    }
  }

  async function handleSubmit() {
    isSubmitting = true;

    try {
      const result = await executeSubmission();

      if (result) {
        onSubmissionComplete?.(result, language, drafts[language]);
      }
    } catch (err) {
      runError = err instanceof Error ? err.message : "Submission failed.";
      bottomTab = "result";
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="flex h-full flex-col bg-stone-50">
  <!-- Top toolbar -->
  <div
    class="flex items-center justify-between border-b border-[color:var(--color-border)] bg-white px-4 py-2"
  >
    <div class="flex items-center gap-3">
      <span class="text-xs font-medium text-stone-500">&lt;/&gt; {$t("editor.code")}</span>
      <select
        class="rounded-md border border-stone-200 bg-transparent px-2 py-1 text-xs"
        onchange={(e) => (language = (e.target as HTMLSelectElement).value as Language)}
        value={language}
      >
        {#each supportedLanguages as entry (entry)}
          <option value={entry}>{entry}</option>
        {/each}
      </select>
      <span class="text-xs text-stone-400">
        {#if contestSlug}
          {$t("editor.contestMode")}
        {:else if assessment}
          {assessment.kind === "exam" ? $t("editor.examMode") : $t("editor.assignmentMode")}
        {:else}
          {$t("editor.practiceMode")}
        {/if}
      </span>
      {#if isFunctionMode}
        <span class="rounded-md bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-600">
          {$t("editor.functionModeHint")}
        </span>
      {/if}
    </div>
  </div>

  <!-- Monaco editor -->
  <div class="min-h-0 flex-1">
    <div bind:this={editorContainer} class="h-full w-full"></div>
  </div>

  <!-- Action bar -->
  <div
    class="flex items-center justify-between border-t border-[color:var(--color-border)] bg-white px-4 py-2"
  >
    <span class="text-xs text-stone-400">
      {new Intl.NumberFormat(currentLocale).format(currentSource.length)} {$t("editor.chars")}
    </span>
    <div class="flex items-center gap-2">
      <button
        class="rounded-lg border border-stone-200 bg-white px-4 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isRunning}
        onclick={() => void handleRun()}
        type="button"
      >
        {isRunning ? $t("editor.running") : $t("editor.run")}
      </button>
      <button
        class="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting}
        onclick={() => void handleSubmit()}
        type="button"
      >
        {isSubmitting ? $t("editor.submitting") : $t("editor.submitButton")}
      </button>
    </div>
  </div>

  <!-- Bottom panel -->
  <div
    class="flex h-[35%] min-h-[180px] flex-col border-t border-[color:var(--color-border)] bg-white"
  >
    <!-- Bottom tabs -->
    <div class="flex items-center border-b border-stone-100 px-2">
      <button
        class="px-3 py-2 text-xs font-medium transition {bottomTab === 'testcase'
          ? 'border-b-2 border-stone-700 text-stone-700'
          : 'text-stone-400 hover:text-stone-600'}"
        onclick={() => (bottomTab = "testcase")}
        type="button"
      >
        {$t("editor.testcase")}
      </button>
      <button
        class="px-3 py-2 text-xs font-medium transition {bottomTab === 'result'
          ? 'border-b-2 border-stone-700 text-stone-700'
          : 'text-stone-400 hover:text-stone-600'}"
        onclick={() => (bottomTab = "result")}
        type="button"
      >
        {$t("editor.testResult")}
      </button>
    </div>

    <!-- Bottom content -->
    <div class="flex-1 overflow-y-auto px-4 py-3">
      {#if bottomTab === "testcase"}
        <div>
          <div class="flex items-center gap-1">
            {#each testcases as _, index (`tab-${index}`)}
              <button
                class="group relative rounded-md px-3 py-1 text-xs font-medium transition {selectedCase ===
                index
                  ? 'bg-stone-100 text-stone-700'
                  : 'text-stone-400 hover:text-stone-600'}"
                onclick={() => (selectedCase = index)}
                type="button"
              >
                Case {index + 1}
                {#if testcases.length > 1}
                  <span
                    class="ml-1.5 hidden text-stone-300 hover:text-red-400 group-hover:inline"
                    role="button"
                    tabindex="-1"
                    onclick={(e: MouseEvent) => {
                      e.stopPropagation();
                      testcases = testcases.filter((_, i) => i !== index);
                      selectedCase = Math.min(selectedCase, testcases.length - 1);
                    }}
                    onkeydown={() => {}}
                  >
                    &times;
                  </span>
                {/if}
              </button>
            {/each}
            <button
              class="rounded-md px-2 py-1 text-xs text-stone-300 transition hover:text-stone-500"
              onclick={() => {
                testcases = [...testcases, { input: "", expectedOutput: "" }];
                selectedCase = testcases.length - 1;
              }}
              type="button"
            >
              +
            </button>
          </div>

          <div class="mt-3">
            <p class="text-xs text-stone-400">{$t("editor.input")}</p>
            <textarea
              class="mt-1 w-full rounded-md bg-stone-50 px-3 py-2 font-mono text-sm text-stone-700 outline-none focus:ring-1 focus:ring-stone-300"
              oninput={(e) => {
                const val = (e.target as HTMLTextAreaElement).value;
                testcases = testcases.map((tc, i) =>
                  i === selectedCase ? { ...tc, input: val } : tc
                );
              }}
              rows={3}
              value={testcases[selectedCase]?.input ?? ""}
            ></textarea>
          </div>

          <div class="mt-3">
            <p class="text-xs text-stone-400">{$t("editor.expectedOutput")}</p>
            <textarea
              class="mt-1 w-full rounded-md bg-stone-50 px-3 py-2 font-mono text-sm text-stone-600 outline-none focus:ring-1 focus:ring-stone-300"
              oninput={(e) => {
                const val = (e.target as HTMLTextAreaElement).value;
                testcases = testcases.map((tc, i) =>
                  i === selectedCase ? { ...tc, expectedOutput: val } : tc
                );
              }}
              rows={2}
              value={testcases[selectedCase]?.expectedOutput ?? ""}
            ></textarea>
          </div>
        </div>
      {:else}
        <div>
          {#if runResult}
            <div>
              <div class="flex items-baseline gap-3">
                <span
                  class="text-lg font-semibold {verdictColor[runResult.verdict] ??
                    'text-stone-700'}"
                >
                  {runVerdictLabel}
                </span>
                {#if runResult.runtimeMs > 0}
                  <span class="text-xs text-stone-400">
                    Runtime: {String(runResult.runtimeMs)} ms
                  </span>
                {/if}
              </div>

              {#if runResult.caseResults && runResult.caseResults.length > 0}
                <div class="mt-3 flex items-center gap-1">
                  {#each runResult.caseResults as cr, index (`rc-${index}`)}
                    <button
                      class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition {selectedResultCase ===
                      index
                        ? 'bg-stone-100 text-stone-700'
                        : 'text-stone-400 hover:text-stone-600'}"
                      onclick={() => (selectedResultCase = index)}
                      type="button"
                    >
                      <span class={cr.passed ? "text-emerald-500" : "text-red-500"}>
                        {cr.passed ? "\u2714" : "\u2718"}
                      </span>
                      Case {index + 1}
                    </button>
                  {/each}
                </div>

                <div class="mt-3 space-y-3">
                  {#if testcases[selectedResultCase]}
                    <div>
                      <p class="text-xs font-medium text-stone-400">{$t("editor.input")}</p>
                      <pre
                        class="mt-1 overflow-x-auto rounded-lg bg-stone-50 px-3 py-2 font-mono text-sm text-stone-700">{testcases[selectedResultCase].input}</pre>
                    </div>
                  {/if}

                  {#if runResult.caseResults[selectedResultCase]}
                    <div>
                      <p class="text-xs font-medium text-stone-400">{$t("editor.output")}</p>
                      <pre
                        class="mt-1 overflow-x-auto rounded-lg bg-stone-50 px-3 py-2 font-mono text-sm text-stone-700">{runResult.caseResults[selectedResultCase].stdout || "(empty)"}</pre>
                    </div>
                  {/if}

                  {#if testcases[selectedResultCase]?.expectedOutput}
                    <div>
                      <p class="text-xs font-medium text-stone-400">
                        {$t("editor.expectedOutput")}
                      </p>
                      <pre
                        class="mt-1 overflow-x-auto rounded-lg bg-stone-50 px-3 py-2 font-mono text-sm text-stone-700">{testcases[selectedResultCase].expectedOutput}</pre>
                    </div>
                  {/if}
                </div>
              {:else if runResult.feedback}
                <p class="mt-2 text-sm leading-6 text-stone-500">
                  {runResult.feedback}
                </p>
              {/if}
            </div>
          {:else if runStatus}
            <div class="flex items-center gap-2 py-4">
              <div
                class="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600"
              ></div>
              <span class="text-sm text-stone-500">{runStatus}</span>
            </div>
          {:else if runError}
            <div class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {runError}
            </div>
          {:else}
            <p class="py-4 text-sm text-stone-400">{$t("editor.runFirst")}</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
