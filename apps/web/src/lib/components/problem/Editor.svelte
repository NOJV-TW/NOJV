<script lang="ts">
  import type * as Monaco from "monaco-editor";
  import { onMount, untrack } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { getLocale } from "$lib/paraglide/runtime.js";
  import {
    apiErrorSchema,
    languageSchema,
    submissionDispatchResponseSchema,
    submissionOperationSchema,
    submissionResultSchema,
    supportedLanguages,
    type Language,
    type SubmissionResult
  } from "@nojv/core";
  import type { ProblemDetail } from "$lib/types";
  import { formatVerdictLabel, verdictColor } from "$lib/types";
  import { registerCompletionProviders } from "./editor-completions";

  const LANGUAGE_STORAGE_KEY = "nojv:editor:language";

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
    allowedLanguages?: Language[] | undefined;
    assessment?: {
      assessmentSlug: string;
      courseSlug: string;
    } | undefined;
    contestSlug?: string | undefined;
    onSubmissionComplete?: ((
      result: SubmissionResult,
      language: string,
      sourceCode: string
    ) => void) | undefined;
    problem: ProblemDetail;
  }

  let { allowedLanguages, assessment, contestSlug, onSubmissionComplete, problem }: Props = $props();
  const initialProblem = untrack(() => problem);

  let currentLocale = $derived(getLocale());
  let isFunctionMode = $derived(problem.submissionType === "function");

  let availableLanguages = $derived.by(() => {
    let langs = [...supportedLanguages];
    // Filter by contest/assignment restriction
    if (allowedLanguages && allowedLanguages.length > 0) {
      langs = langs.filter((l) => allowedLanguages!.includes(l));
    }
    // Filter by template availability (function-mode problems)
    if (problem.submissionType === "function") {
      const templateLangs = Object.keys(problem.templates) as Language[];
      langs = langs.filter((l) => templateLangs.includes(l));
    }
    return langs;
  });

  let language = $state<Language>((() => {
    try {
      const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      const parsed = languageSchema.safeParse(saved);
      if (parsed.success) return parsed.data;
    } catch {}
    return "cpp";
  })());
  let drafts = $state({ ...initialProblem.starterByLanguage });
  let isRunning = $state(false);
  let isSubmitting = $state(false);

  // Bottom panel state
  let bottomTab = $state<"testcase" | "result">("testcase");
  let selectedCase = $state(0);
  let selectedResultCase = $state(0);
  let testcases = $state(
    initialProblem.samples.map((s) => ({ input: s.input, expectedOutput: s.output }))
  );
  let runResult = $state<SubmissionResult | null>(null);
  let runStatus = $state<string | null>(null);
  let runError = $state<string | null>(null);

  // Auto-select first available language if current selection becomes invalid
  $effect(() => {
    if (availableLanguages.length > 0 && !availableLanguages.includes(language)) {
      language = availableLanguages[0]!;
    }
  });

  // Persist language choice to localStorage
  $effect(() => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {}
  });

  let currentSource = $derived(drafts[language]);
  let runVerdictLabel = $derived(
    runResult ? formatVerdictLabel(runResult.verdict) : undefined
  );

  // Monaco editor
  let editorContainer: HTMLDivElement;
  let monacoEditor: Monaco.editor.IStandaloneCodeEditor | undefined;
  let monacoModule: typeof Monaco | undefined;

  // Cleanup: abort in-flight polls when component is destroyed
  let destroyed = false;
  let pollAbortController: AbortController | null = null;

  onMount(() => {
    void (async () => {
      monacoModule = await import("monaco-editor");
      registerCompletionProviders(monacoModule);
      monacoEditor = monacoModule.editor.create(editorContainer, {
        ...editorOptions,
        language: "cpp",
        theme: "vs-light",
        value: drafts[language]
      });

      const editor = monacoEditor;
      editor.onDidChangeModelContent(() => {
        drafts[language] = editor.getValue();
      });
    })();

    return () => {
      destroyed = true;
      pollAbortController?.abort();
      monacoEditor?.dispose();
    };
  });

  $effect(() => {
    // Read reactive values BEFORE the guard so they are always tracked.
    const lang = language;
    const draft = drafts[lang];
    if (!monacoEditor || !monacoModule) return;
    const model = monacoEditor.getModel();
    if (!model) return;
    const langMap: Record<string, string> = {
      c: "c",
      cpp: "cpp",
      go: "go",
      java: "java",
      javascript: "javascript",
      python: "python",
      rust: "rust",
      typescript: "typescript"
    };
    monacoModule.editor.setModelLanguage(model, langMap[lang] ?? lang);
    if (monacoEditor.getValue() !== draft) {
      monacoEditor.setValue(draft);
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
        mode: contestSlug ? "contest" : (assessment ? "assignment" : "practice"),
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
      const parsed = apiErrorSchema.safeParse(await response.json());
      throw new Error(parsed.success ? parsed.data.message : "Submission failed.");
    }

    const dispatch = submissionDispatchResponseSchema.parse(await response.json());
    const startedAt = Date.now();
    let pollDelay = 500;

    while (Date.now() - startedAt < 30_000) {
      if (destroyed) return null;

      const poll = await fetch(dispatch.pollUrl, { cache: "no-store", signal });

      if (!poll.ok) {
        const parsed = apiErrorSchema.safeParse(await poll.json());
        throw new Error(parsed.success ? parsed.data.message : "Polling failed.");
      }

      const operation = submissionOperationSchema.parse(await poll.json());

      if (operation.result) {
        return submissionResultSchema.parse(operation.result);
      }

      await new Promise((resolve) => {
        setTimeout(resolve, pollDelay);
      });
      pollDelay = Math.min(pollDelay * 1.5, 3000);
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
    class="flex items-center justify-between border-b border-border bg-white px-4 py-2"
  >
    <div class="flex items-center gap-3">
      <span class="text-xs font-medium text-stone-500">&lt;/&gt; {m.editor_code()}</span>
      <select
        class="rounded-md border border-stone-200 bg-transparent px-2 py-1 text-xs"
        onchange={(e) => {
          const parsed = languageSchema.safeParse((e.target as HTMLSelectElement).value);
          if (parsed.success) language = parsed.data;
        }}
        value={language}
      >
        {#each availableLanguages as entry (entry)}
          <option value={entry}>{entry}</option>
        {/each}
      </select>
      <span class="text-xs text-stone-400">
        {#if contestSlug}
          {m.editor_contestMode()}
        {:else if assessment}
          {m.editor_assignmentMode()}
        {:else}
          {m.editor_practiceMode()}
        {/if}
      </span>
      {#if isFunctionMode}
        <span class="rounded-md bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-600">
          {m.editor_functionModeHint()}
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
    class="flex items-center justify-between border-t border-border bg-white px-4 py-2"
  >
    <span class="text-xs text-stone-400">
      {new Intl.NumberFormat(currentLocale).format(currentSource.length)} {m.editor_chars()}
    </span>
    <div class="flex items-center gap-2">
      <button
        class="rounded-lg border border-stone-200 bg-white px-4 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isRunning || availableLanguages.length === 0}
        onclick={() => void handleRun()}
        type="button"
      >
        {isRunning ? m.editor_running() : m.editor_run()}
      </button>
      <button
        class="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting || availableLanguages.length === 0}
        onclick={() => void handleSubmit()}
        type="button"
      >
        {isSubmitting ? m.editor_submitting() : m.editor_submitButton()}
      </button>
    </div>
  </div>

  <!-- Bottom panel -->
  <div
    class="flex h-[35%] min-h-[180px] flex-col border-t border-border bg-white"
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
        {m.editor_testcase()}
      </button>
      <button
        class="px-3 py-2 text-xs font-medium transition {bottomTab === 'result'
          ? 'border-b-2 border-stone-700 text-stone-700'
          : 'text-stone-400 hover:text-stone-600'}"
        onclick={() => (bottomTab = "result")}
        type="button"
      >
        {m.editor_testResult()}
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
            <p class="text-xs text-stone-400">{m.editor_input()}</p>
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
            <p class="text-xs text-stone-400">{m.editor_expectedOutput()}</p>
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
                      <p class="text-xs font-medium text-stone-400">{m.editor_input()}</p>
                      <pre
                        class="mt-1 overflow-x-auto rounded-lg bg-stone-50 px-3 py-2 font-mono text-sm text-stone-700">{testcases[selectedResultCase]!.input}</pre>
                    </div>
                  {/if}

                  {#if runResult.caseResults[selectedResultCase]}
                    {@const caseData = runResult.caseResults[selectedResultCase]!}
                    <div>
                      <p class="text-xs font-medium text-stone-400">{m.editor_output()}</p>
                      <pre
                        class="mt-1 overflow-x-auto rounded-lg bg-stone-50 px-3 py-2 font-mono text-sm text-stone-700">{caseData.stdout || "(empty)"}</pre>
                    </div>
                    {#if caseData.stderr}
                      <div>
                        <p class="text-xs font-medium text-red-400">Stderr</p>
                        <pre
                          class="mt-1 overflow-x-auto rounded-lg bg-red-50 px-3 py-2 font-mono text-sm text-red-700">{caseData.stderr}</pre>
                      </div>
                    {/if}
                  {/if}

                  {#if testcases[selectedResultCase]?.expectedOutput}
                    <div>
                      <p class="text-xs font-medium text-stone-400">
                        {m.editor_expectedOutput()}
                      </p>
                      <pre
                        class="mt-1 overflow-x-auto rounded-lg bg-stone-50 px-3 py-2 font-mono text-sm text-stone-700">{testcases[selectedResultCase]!.expectedOutput}</pre>
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
            <p class="py-4 text-sm text-stone-400">{m.editor_runFirst()}</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
