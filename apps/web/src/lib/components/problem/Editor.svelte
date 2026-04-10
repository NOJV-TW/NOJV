<script lang="ts">
  import type * as Monaco from "monaco-editor";
  import { onMount, untrack } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { getLocale } from "$lib/paraglide/runtime.js";
  import {
    apiErrorSchema,
    entryFileNameFor,
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
  import MonacoEditableRegions from "./workspace/MonacoEditableRegions.svelte";

  const LANGUAGE_STORAGE_KEY = "nojv:editor:language";

  const editorOptions = {
    automaticLayout: true,
    fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
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
    // Workspace-file mode: hide languages without an editable `main.<ext>`
    // entry file for this problem, so students can't select a language they
    // can't actually submit in.
    const hasAnyWorkspace = problem.workspaceFiles.length > 0;
    if (hasAnyWorkspace) {
      langs = langs.filter((l) => {
        const entry = entryFileNameFor(l);
        return problem.workspaceFiles.some(
          (f) =>
            f.language === l && f.path === entry && f.visibility === "editable"
        );
      });
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
    initialProblem.samples.map((s) => ({ input: s.stdin, expectedOutput: s.expected }))
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

  // ── Workspace-file (Phase 4) state ──
  // `problem.workspaceFiles` includes `editable`, `readonly`, and `hidden`
  // files. Hidden files arrive with `content: ""` from the domain layer — raw
  // content never leaves the server — but their metadata (path, description)
  // is shown to the student.
  type WorkspaceFile = ProblemDetail["workspaceFiles"][number];

  // Per-file drafts keyed by `${language}::${path}`. Editable files are
  // mutable in-place; readonly files keep their original content.
  function workspaceDraftKey(lang: string, path: string): string {
    return `${lang}::${path}`;
  }
  let workspaceDrafts = $state<Record<string, string>>({});
  // Seed drafts for every visible workspace file up-front so switches are
  // instantaneous and no file is missing content on first render.
  for (const f of initialProblem.workspaceFiles) {
    workspaceDrafts[workspaceDraftKey(f.language, f.path)] = f.content;
  }

  let workspaceFilesForLanguage = $derived(
    problem.workspaceFiles.filter((f) => f.language === language)
  );
  let isWorkspaceMode = $derived(workspaceFilesForLanguage.length > 0);
  let selectedWorkspaceIndex = $state(0);

  // When the language changes (or the file list otherwise changes), reset
  // selection. Prefer `main.<ext>` if the problem has it as an editable file;
  // otherwise fall back to the first editable file, then to index 0.
  $effect(() => {
    void language;
    const files = workspaceFilesForLanguage;
    const entry = entryFileNameFor(language);
    const entryIndex = files.findIndex(
      (f) => f.path === entry && f.visibility === "editable"
    );
    if (entryIndex >= 0) {
      selectedWorkspaceIndex = entryIndex;
      return;
    }
    const firstEditable = files.findIndex((f) => f.visibility === "editable");
    selectedWorkspaceIndex = firstEditable >= 0 ? firstEditable : 0;
  });

  let selectedWorkspaceFile = $derived<WorkspaceFile | undefined>(
    workspaceFilesForLanguage[selectedWorkspaceIndex]
  );
  let selectedWorkspaceContent = $derived(
    selectedWorkspaceFile
      ? (workspaceDrafts[
          workspaceDraftKey(selectedWorkspaceFile.language, selectedWorkspaceFile.path)
        ] ?? selectedWorkspaceFile.content)
      : ""
  );

  function handleWorkspaceFileChange(value: string) {
    const file = selectedWorkspaceFile;
    if (!file || file.visibility !== "editable") return;
    workspaceDrafts[workspaceDraftKey(file.language, file.path)] = value;
  }

  let currentSource = $derived(
    isWorkspaceMode ? selectedWorkspaceContent : drafts[language]
  );
  let runVerdictLabel = $derived(
    runResult ? formatVerdictLabel(runResult.verdict) : undefined
  );

  // Monaco editor
  let editorContainer: HTMLDivElement = $state(null!);
  let monacoEditor: Monaco.editor.IStandaloneCodeEditor | undefined;
  let monacoModule: typeof Monaco | undefined;

  // Cleanup: abort in-flight polls when component is destroyed
  let destroyed = false;
  let pollAbortController: AbortController | null = null;

  // ── Resizable workspace layout ──
  // `filesWidth` controls the horizontal split between the FILES sidebar
  // and the code editor in workspace mode. `bottomPanelHeight` controls
  // the vertical split between the editor area (toolbar + code + action
  // bar) and the bottom panel (testcase/result) — which also effectively
  // resizes the FILES sidebar's height.
  let filesWidth = $state(220);
  let bottomPanelHeight = $state(260);
  let outerContainer: HTMLDivElement = $state(null!);
  let workspaceLayoutContainer: HTMLDivElement | null = $state(null);

  function startFilesResize(e: MouseEvent) {
    e.preventDefault();
    const container = workspaceLayoutContainer;
    if (!container) return;

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const next = ev.clientX - rect.left;
      filesWidth = Math.max(120, Math.min(rect.width * 0.7, next));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function startBottomResize(e: MouseEvent) {
    e.preventDefault();
    const container = outerContainer;
    if (!container) return;

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const next = rect.bottom - ev.clientY;
      bottomPanelHeight = Math.max(120, Math.min(rect.height * 0.8, next));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  onMount(() => {
    let themeObserver: MutationObserver | undefined;

    // Workspace-file mode uses <MonacoEditableRegions> which owns its own Monaco instance;
    // the single-file editor is still mounted (just visually hidden) so switching to a
    // language without workspace files works without re-initializing.
    void (async () => {
      monacoModule = await import("monaco-editor");
      registerCompletionProviders(monacoModule);

      const isDark = document.documentElement.classList.contains("dark");
      monacoEditor = monacoModule.editor.create(editorContainer, {
        ...editorOptions,
        language: "cpp",
        theme: isDark ? "vs-dark" : "vs-light",
        value: drafts[language]
      });

      const editor = monacoEditor;
      editor.onDidChangeModelContent(() => {
        drafts[language] = editor.getValue();
      });

      // Watch for dark mode toggling on <html>
      themeObserver = new MutationObserver(() => {
        const dark = document.documentElement.classList.contains("dark");
        monacoModule!.editor.setTheme(dark ? "vs-dark" : "vs-light");
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"]
      });
    })();

    return () => {
      destroyed = true;
      pollAbortController?.abort();
      themeObserver?.disconnect();
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

    const commonFields = {
      assessment,
      contestSlug,
      language,
      mode: contestSlug ? "contest" : (assessment ? "assignment" : "practice"),
      problemId: problem.id,
      // Backward compatibility: some stale backend bundles still validate `problemSlug`.
      problemSlug: problem.id,
      sampleOnly: options?.sampleOnly ?? false,
    };

    let body: Record<string, unknown>;
    if (isWorkspaceMode) {
      // Workspace-file mode: send the current contents of every visible file
      // (editable + readonly) so the server can merge them with hidden files
      // when building the judge context. Hidden files are excluded — their
      // `content` is `""` on the client and the server reads the real content
      // from the DB. `sourceCode` is the first editable file's draft — used
      // by legacy views that expect a single blob.
      const files = workspaceFilesForLanguage.filter(
        (f) => f.visibility !== "hidden"
      );
      const currentContents = files.map((f) => ({
        path: f.path,
        content:
          f.visibility === "editable"
            ? (workspaceDrafts[workspaceDraftKey(f.language, f.path)] ?? f.content)
            : f.content,
      }));
      const firstEditable =
        files.find((f) => f.visibility === "editable") ?? files[0];
      const sourceCode = firstEditable
        ? currentContents.find((c) => c.path === firstEditable.path)?.content ?? ""
        : "";
      body = {
        ...commonFields,
        sourceCode,
        sourceFiles: currentContents,
      };
    } else {
      body = {
        ...commonFields,
        sourceCode: drafts[language],
      };
    }

    const response = await fetch("/api/submissions", {
      body: JSON.stringify(body),
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
        let sourceForCallback: string;
        if (isWorkspaceMode) {
          // Mirror the submission payload: concatenate every visible file with
          // a path marker so the submissions pane has a useful preview. Hidden
          // files are skipped — their `content` is `""` on the client.
          sourceForCallback = workspaceFilesForLanguage
            .filter((f) => f.visibility !== "hidden")
            .map((f) => {
              const content =
                f.visibility === "editable"
                  ? (workspaceDrafts[workspaceDraftKey(f.language, f.path)] ?? f.content)
                  : f.content;
              return `// --- ${f.path} ---\n${content}`;
            })
            .join("\n\n");
        } else {
          sourceForCallback = drafts[language];
        }
        onSubmissionComplete?.(result, language, sourceForCallback);
      }
    } catch (err) {
      runError = err instanceof Error ? err.message : "Submission failed.";
      bottomTab = "result";
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div
  bind:this={outerContainer}
  class="flex h-full flex-col overflow-hidden border border-border bg-[color:var(--color-panel)]"
>
  <!-- Top toolbar -->
  <div
    class="flex h-11 items-center justify-between border-b border-border bg-muted/40 px-3"
  >
    <div class="flex items-center gap-3">
      <span class="text-xs font-semibold text-foreground/70">&lt;/&gt;</span>
      <select
        class="border border-border bg-[color:var(--color-panel)] px-2.5 py-1 text-xs font-medium text-foreground outline-none transition focus:border-primary"
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
      {#if isFunctionMode}
        <span class="rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-medium text-violet-600 dark:text-violet-400">
          {m.editor_functionModeHint()}
        </span>
      {/if}
    </div>
    {#if contestSlug}
      <span class="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
        {m.editor_contestMode()}
      </span>
    {:else if assessment}
      <span class="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-medium text-sky-600 dark:text-sky-400">
        {m.editor_assignmentMode()}
      </span>
    {/if}
  </div>

  <!-- Editor area -->
  <!--
    The single-file Monaco container is always present so the underlying
    editor survives switches in and out of workspace mode. When workspace
    files exist for the current language, we overlay the workspace UI on
    top and hide the single-file container via `hidden`.
  -->
    <div class="relative min-h-0 flex-1">
      <div
        bind:this={editorContainer}
        class="h-full w-full"
        class:hidden={isWorkspaceMode}
      ></div>
      {#if isWorkspaceMode}
        <div bind:this={workspaceLayoutContainer} class="absolute inset-0 flex">
          <!-- Student-side file navigation. Read-only list — students can't
               add or remove files, only the TA-side problem editor does that. -->
          <aside
            class="shrink-0 overflow-y-auto bg-[color:var(--color-panel)] p-2"
            style="width: {filesWidth}px"
          >
            <p class="mb-2 px-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Files
            </p>
            <ul class="space-y-0.5">
              {#each workspaceFilesForLanguage as file, index (`${file.language}::${file.path}`)}
                <li>
                  <button
                    type="button"
                    class="flex w-full items-center justify-between px-2 py-1.5 text-left text-sm transition hover:bg-accent {selectedWorkspaceIndex ===
                    index
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground'}"
                    onclick={() => (selectedWorkspaceIndex = index)}
                  >
                    <span class="truncate font-mono text-xs">
                      {#if file.visibility === 'hidden'}🔒 {/if}{file.path}
                    </span>
                    <span
                      class="ml-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide {file.visibility ===
                      'editable'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                        : file.visibility === 'hidden'
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                          : 'bg-muted text-muted-foreground'}"
                    >
                      {file.visibility === 'editable'
                        ? 'edit'
                        : file.visibility === 'hidden'
                          ? 'hidden'
                          : 'read'}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          </aside>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="group relative w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40 active:bg-primary/60"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize files panel"
            tabindex="0"
            onmousedown={startFilesResize}
            onkeydown={(e) => {
              if (e.key === "ArrowLeft") filesWidth = Math.max(120, filesWidth - 16);
              if (e.key === "ArrowRight") filesWidth = Math.min(600, filesWidth + 16);
            }}
          ></div>
          <div class="flex min-w-0 flex-1 flex-col">
            {#if selectedWorkspaceFile}
              {@const file = selectedWorkspaceFile}
              {#if file.visibility !== 'hidden' && file.description !== ''}
                <p class="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                  {file.description}
                </p>
              {/if}
              <div class="min-h-0 flex-1">
                {#if file.visibility === 'hidden'}
                  <div class="flex h-full flex-col gap-3 overflow-y-auto px-6 py-6">
                    <h3 class="text-sm font-semibold text-foreground">
                      {m.workspace_fileHidden()}
                    </h3>
                    {#if file.description !== ''}
                      <div class="max-w-prose whitespace-pre-wrap border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                        {file.description}
                      </div>
                    {:else}
                      <p class="text-sm text-muted-foreground/70 italic">
                        {m.workspace_fileHiddenNoDescription()}
                      </p>
                    {/if}
                  </div>
                {:else}
                  {#key `${file.language}::${file.path}`}
                    <MonacoEditableRegions
                      value={selectedWorkspaceContent}
                      onchange={handleWorkspaceFileChange}
                      language={file.language}
                      readonly={file.visibility === "readonly"}
                      editableRegions={file.visibility === "editable" ? file.editableRegions : null}
                      height="100%"
                    />
                  {/key}
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>

  <!-- Action bar -->
  <div
    class="flex items-center justify-between border-t border-border bg-muted/40 px-4 py-2.5"
  >
    <span class="text-xs font-medium text-muted-foreground">
      {new Intl.NumberFormat(currentLocale).format(currentSource.length)} {m.editor_chars()}
    </span>
    <div class="flex items-center gap-2">
      <button
        class="rounded-full border border-border px-4 py-1.5 text-sm font-medium text-foreground transition hover:-translate-y-0.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isRunning || availableLanguages.length === 0}
        onclick={() => void handleRun()}
        type="button"
      >
        {isRunning ? m.editor_running() : m.editor_run()}
      </button>
      <button
        class="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting || availableLanguages.length === 0}
        onclick={() => void handleSubmit()}
        type="button"
      >
        {isSubmitting ? m.editor_submitting() : m.editor_submitButton()}
      </button>
    </div>
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- Vertical resize handle between editor area and bottom panel -->
  <div
    class="h-1 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-primary/40 active:bg-primary/60"
    role="separator"
    aria-orientation="horizontal"
    aria-label="Resize bottom panel"
    tabindex="0"
    onmousedown={startBottomResize}
    onkeydown={(e) => {
      if (e.key === "ArrowUp") bottomPanelHeight = Math.min(800, bottomPanelHeight + 16);
      if (e.key === "ArrowDown") bottomPanelHeight = Math.max(120, bottomPanelHeight - 16);
    }}
  ></div>
  <!-- Bottom panel -->
  <div
    class="flex shrink-0 flex-col"
    style="height: {bottomPanelHeight}px"
  >
    <!-- Bottom tabs -->
    <div class="flex items-center border-b border-border px-2">
      <button
        class="px-3 py-2 text-xs font-medium transition {bottomTab === 'testcase'
          ? 'border-b-2 border-foreground text-foreground'
          : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => (bottomTab = "testcase")}
        type="button"
      >
        {m.editor_testcase()}
      </button>
      <button
        class="px-3 py-2 text-xs font-medium transition {bottomTab === 'result'
          ? 'border-b-2 border-foreground text-foreground'
          : 'text-muted-foreground hover:text-foreground'}"
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
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'}"
                onclick={() => (selectedCase = index)}
                type="button"
              >
                Case {index + 1}
                {#if testcases.length > 1}
                  <span
                    class="ml-1.5 hidden text-muted-foreground hover:text-red-400 group-hover:inline"
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
              class="rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground"
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
            <p class="text-xs text-muted-foreground">{m.editor_input()}</p>
            <textarea
              class="mt-1 w-full rounded-md bg-muted px-3 py-2 font-mono text-sm text-foreground outline-none focus:ring-1 focus:ring-border"
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
            <p class="text-xs text-muted-foreground">{m.editor_expectedOutput()}</p>
            <textarea
              class="mt-1 w-full rounded-md bg-muted px-3 py-2 font-mono text-sm text-muted-foreground outline-none focus:ring-1 focus:ring-border"
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
                    'text-foreground'}"
                >
                  {runVerdictLabel}
                </span>
                {#if runResult.runtimeMs > 0}
                  <span class="text-xs text-muted-foreground">
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
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:text-foreground'}"
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
                      <p class="text-xs font-medium text-muted-foreground">{m.editor_input()}</p>
                      <pre
                        class="mt-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-sm text-foreground">{testcases[selectedResultCase]!.input}</pre>
                    </div>
                  {/if}

                  {#if runResult.caseResults[selectedResultCase]}
                    {@const caseData = runResult.caseResults[selectedResultCase]!}
                    <div>
                      <p class="text-xs font-medium text-muted-foreground">{m.editor_output()}</p>
                      <pre
                        class="mt-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-sm text-foreground">{caseData.stdout || "(empty)"}</pre>
                    </div>
                    {#if caseData.stderr}
                      <div>
                        <p class="text-xs font-medium text-red-400 dark:text-red-400">Stderr</p>
                        <pre
                          class="mt-1 overflow-x-auto rounded-lg bg-red-500/10 px-3 py-2 font-mono text-sm text-red-700 dark:text-red-400">{caseData.stderr}</pre>
                      </div>
                    {/if}
                  {/if}

                  {#if testcases[selectedResultCase]?.expectedOutput}
                    <div>
                      <p class="text-xs font-medium text-muted-foreground">
                        {m.editor_expectedOutput()}
                      </p>
                      <pre
                        class="mt-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-sm text-foreground">{testcases[selectedResultCase]!.expectedOutput}</pre>
                    </div>
                  {/if}
                </div>
              {:else if runResult.feedback}
                <p class="mt-2 text-sm leading-6 text-muted-foreground">
                  {runResult.feedback}
                </p>
              {/if}
            </div>
          {:else if runStatus}
            <div class="flex items-center gap-2 py-4">
              <div
                class="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground"
              ></div>
              <span class="text-sm text-muted-foreground">{runStatus}</span>
            </div>
          {:else if runError}
            <div class="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
              {runError}
            </div>
          {:else}
            <p class="py-4 text-sm text-muted-foreground">{m.editor_runFirst()}</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
