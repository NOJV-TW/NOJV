<script lang="ts">
  import { untrack } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { getLocale } from "$lib/paraglide/runtime.js";
  import {
    entryFileNameFor,
    languageSchema,
    type Language,
    type SubmissionResult
  } from "@nojv/core";
  import type { ProblemDetail } from "$lib/types";
  import EditorCore from "./EditorCore.svelte";
  import LanguageSelector from "./LanguageSelector.svelte";
  import EditorBottomPanel from "./EditorBottomPanel.svelte";
  import StudentWorkspaceView from "./StudentWorkspaceView.svelte";
  import {
    executeSubmission,
    type SubmissionWorkspaceFilePayload
  } from "$lib/services/submission-service";

  const LANGUAGE_STORAGE_KEY = "nojv:editor:language";

  interface Props {
    allowedLanguages?: Language[] | undefined;
    assessment?: {
      assessmentSlug: string;
      courseId: string;
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

  // `LanguageSelector` owns the language-availability logic; we mirror its
  // computed list so the action bar can disable Run/Submit when empty.
  let availableLanguages = $state<Language[]>([]);

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

  // Bottom panel state — tab + last-run snapshot live here because the
  // Run/Submit flow below drives them.
  let bottomTab = $state<"testcase" | "result">("testcase");
  let runResult = $state<SubmissionResult | null>(null);
  let runStatus = $state<string | null>(null);
  let runError = $state<string | null>(null);

  // Run cases owned here so the Run handler can forward them to the
  // submission service. Seeded from `problem.samples` on first render;
  // students mutate them via `EditorBottomPanel` (bindable). Special-env
  // problems skip this entirely — the TA image owns the testcase
  // format, so the panel shows a read-only notice instead.
  let panelRunCases = $state<{ input: string; expectedOutput: string }[]>(
    initialProblem.samples.map((s) => ({ input: s.input, expectedOutput: s.output }))
  );
  let isSpecialEnv = $derived(problem.type === "special_env");

  // Persist language choice to localStorage so the student sees the same
  // default when they come back to any problem.
  $effect(() => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {}
  });

  // ── Workspace-file state ──
  // `problem.workspaceFiles` includes `editable`, `readonly`, and `hidden`
  // files. Hidden files arrive with `content: ""` from the domain layer —
  // raw content never leaves the server — but their metadata (path,
  // description) is still shown to the student.
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
  // selection. Prefer `main.<ext>` if the problem has it as an editable
  // file; otherwise fall back to the first editable file, then to index 0.
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

  // Cleanup: abort in-flight polls when the component is destroyed.
  let destroyed = false;
  let pollAbortController: AbortController | null = null;
  $effect(() => () => {
    destroyed = true;
    pollAbortController?.abort();
  });

  // ── Resizable bottom panel ──
  // The horizontal FILES-panel split lives inside `StudentWorkspaceView`.
  let bottomPanelHeight = $state(260);
  let outerContainer: HTMLDivElement = $state(null!);

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

  // ── Submission helpers ──
  // Collect the full set of non-hidden workspace files for the current
  // language, merging each editable file's latest draft back on top.
  function currentWorkspaceFiles(): SubmissionWorkspaceFilePayload[] {
    return workspaceFilesForLanguage
      .filter((f) => f.visibility !== "hidden")
      .map((f) => ({
        path: f.path,
        content:
          f.visibility === "editable"
            ? (workspaceDrafts[workspaceDraftKey(f.language, f.path)] ?? f.content)
            : f.content
      }));
  }

  // Materialize the panel's current run cases into the wire shape for
  // a Run dispatch. Only called when `sampleOnly && !isSpecialEnv`; on
  // Submit or special-env problems we return undefined and the server
  // uses the graded set (Submit) or TA-bundled testcases (special env).
  function runCasesForRequest(): { input: string; expectedOutput?: string }[] | undefined {
    if (isSpecialEnv) return undefined;
    // Pass through exactly what's in the panel (even empty strings) so
    // the sandbox-runner sees the same bytes the student typed. An
    // undefined `expectedOutput` means "don't compare, just echo
    // stdout"; we preserve that distinction here.
    return panelRunCases.map((tc) => {
      const mapped: { input: string; expectedOutput?: string } = { input: tc.input };
      if (tc.expectedOutput !== "") mapped.expectedOutput = tc.expectedOutput;
      return mapped;
    });
  }

  async function runSubmission(sampleOnly: boolean): Promise<SubmissionResult | null> {
    pollAbortController = new AbortController();
    const { signal } = pollAbortController;

    const runCases = sampleOnly ? runCasesForRequest() : undefined;

    if (isWorkspaceMode) {
      // Workspace-file mode: send the current contents of every visible
      // file so the server can merge them with hidden files when building
      // the judge context. `sourceCode` is the first editable file's
      // draft — kept alongside `sourceFiles` for callers that still
      // expect a single blob.
      const files = currentWorkspaceFiles();
      const firstEditable =
        workspaceFilesForLanguage.find((f) => f.visibility === "editable") ??
        workspaceFilesForLanguage[0];
      const sourceCode = firstEditable
        ? files.find((c) => c.path === firstEditable.path)?.content ?? ""
        : "";

      return executeSubmission(
        {
          assessment,
          contestSlug,
          language,
          problemId: problem.id,
          ...(runCases ? { runCases } : {}),
          sampleOnly,
          sourceCode,
          sourceFiles: files
        },
        { signal }
      ).then((result) => (destroyed ? null : result));
    }

    return executeSubmission(
      {
        assessment,
        contestSlug,
        language,
        problemId: problem.id,
        ...(runCases ? { runCases } : {}),
        sampleOnly,
        sourceCode: drafts[language]
      },
      { signal }
    ).then((result) => (destroyed ? null : result));
  }

  async function handleRun() {
    isRunning = true;
    runResult = null;
    runStatus = "running";
    runError = null;
    bottomTab = "result";

    try {
      const result = await runSubmission(true);
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
      const result = await runSubmission(false);

      if (result) {
        let sourceForCallback: string;
        if (isWorkspaceMode) {
          // Mirror the submission payload: concatenate every visible file
          // with a path marker so the submissions pane has a useful
          // preview. Hidden files are skipped — their `content` is `""`
          // on the client.
          sourceForCallback = currentWorkspaceFiles()
            .map((f) => `// --- ${f.path} ---\n${f.content}`)
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
    class="flex h-11 items-center justify-between border-b border-border-subtle bg-muted/40 px-3"
  >
    <div class="flex items-center gap-3">
      <span class="text-caption font-semibold text-foreground/70">&lt;/&gt;</span>
      <LanguageSelector
        value={language}
        {allowedLanguages}
        workspaceFiles={problem.workspaceFiles}
        onchange={(next) => (language = next)}
        onavailablechange={(available) => (availableLanguages = available)}
      />
    </div>
    {#if contestSlug}
      <span class="rounded-full bg-warning/15 px-2.5 py-0.5 text-caption font-medium text-warning">
        {m.editor_contestMode()}
      </span>
    {:else if assessment}
      <span class="rounded-full bg-info/15 px-2.5 py-0.5 text-caption font-medium text-info">
        {m.editor_assignmentMode()}
      </span>
    {/if}
  </div>

  <!--
    The single-file Monaco container is always mounted so the underlying
    editor survives switches in and out of workspace mode. When workspace
    files exist for the current language, we overlay the workspace UI on
    top and hide the single-file container via `hidden`.
  -->
  <div class="relative min-h-0 flex-1">
    <EditorCore
      {language}
      {drafts}
      hidden={isWorkspaceMode}
      onchange={(value) => (drafts[language] = value)}
    />
    {#if isWorkspaceMode}
      <StudentWorkspaceView
        files={workspaceFilesForLanguage}
        selectedIndex={selectedWorkspaceIndex}
        selectedContent={selectedWorkspaceContent}
        onselect={(index) => (selectedWorkspaceIndex = index)}
        onfilechange={handleWorkspaceFileChange}
      />
    {/if}
  </div>

  <!-- Action bar -->
  <div
    class="flex items-center justify-between border-t border-border-subtle bg-muted/40 px-4 py-2.5"
  >
    <span class="text-caption font-medium text-muted-foreground tabular-nums">
      {new Intl.NumberFormat(currentLocale).format(currentSource.length)} {m.editor_chars()}
    </span>
    <div class="flex items-center gap-2">
      <button
        class="rounded-full border border-border px-4 py-1.5 text-body-sm font-medium text-foreground transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isRunning || availableLanguages.length === 0}
        onclick={() => void handleRun()}
        type="button"
      >
        {isRunning ? m.editor_running() : m.editor_run()}
      </button>
      <button
        class="rounded-full bg-success px-4 py-1.5 text-body-sm font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-60"
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
  <div class="shrink-0" style="height: {bottomPanelHeight}px">
    <EditorBottomPanel
      bind:runCases={panelRunCases}
      readOnly={isSpecialEnv}
      tab={bottomTab}
      {runResult}
      {runStatus}
      {runError}
      ontabchange={(next) => (bottomTab = next)}
    />
  </div>
</div>
