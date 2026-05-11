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
  import { Maximize2, Minimize2, RotateCcw } from "@lucide/svelte";
  import EditorCore from "./EditorCore.svelte";
  import LanguageSelector from "./LanguageSelector.svelte";
  import EditorBottomPanel from "./EditorBottomPanel.svelte";
  import StudentWorkspaceView from "./StudentWorkspaceView.svelte";
  import {
    executeSubmission,
    type SubmissionWorkspaceFilePayload
  } from "$lib/services/submission-service";
  import {
    clearDraft,
    loadDraft,
    saveDraft,
    type DraftContext
  } from "$lib/stores/code-draft";
  import { shortcuts } from "$lib/stores/shortcuts.svelte";
  import { toasts } from "$lib/stores/toast";

  const LANGUAGE_STORAGE_KEY = "nojv:editor:language";

  interface Props {
    allowedLanguages?: Language[] | undefined;
    assessment?: {
      assessmentId: string;
      courseId: string;
    } | undefined;
    contestId?: string | undefined;
    draftContext?: DraftContext | undefined;
    onSubmissionComplete?: ((
      result: SubmissionResult,
      language: string,
      sourceCode: string
    ) => void) | undefined;
    problem: ProblemDetail;
  }

  let {
    allowedLanguages,
    assessment,
    contestId,
    draftContext,
    onSubmissionComplete,
    problem
  }: Props = $props();
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
  let lastSavedCode = $state<Record<string, string>>({});
  let lastSavedAt = $state<Record<string, number | null>>({});
  let hydratedLanguages = $state<Record<string, boolean>>({});
  let isRunning = $state(false);
  let isSubmitting = $state(false);
  let isFullscreen = $state(false);

  function handleReset() {
    if (typeof window === "undefined") return;
    if (!window.confirm(m.editor_resetConfirm())) return;
    if (isWorkspaceMode) {
      for (const f of initialProblem.workspaceFiles) {
        if (f.language !== language || f.visibility !== "editable") continue;
        workspaceDrafts[workspaceDraftKey(f.language, f.path)] = f.content;
      }
    } else {
      drafts[language] = initialProblem.starterByLanguage[language] ?? "";
    }
  }

  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
  }

  $effect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") isFullscreen = false;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Bottom panel state — tab + last-run snapshot live here because the
  // Run/Submit flow below drives them.
  let bottomTab = $state<"testcase" | "result">("testcase");
  let runResult = $state<SubmissionResult | null>(null);
  let runStatus = $state<string | null>(null);
  let runError = $state<string | null>(null);

  // Special-env problems skip student-owned cases — the TA image owns the testcase format.
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

  // Hidden workspace files arrive with `content: ""` — raw content never leaves the server.
  type WorkspaceFile = ProblemDetail["workspaceFiles"][number];

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

  // Hydrate per-language draft on first visit + on language switch. Workspace
  // mode is excluded (no path dimension in draft key); see design doc.
  $effect(() => {
    if (isWorkspaceMode) return;
    if (!draftContext) return;
    const lang = language;
    if (hydratedLanguages[lang]) return;
    const record = loadDraft({ context: draftContext, problemId: problem.id, language: lang });
    if (record) {
      drafts[lang] = record.code;
      lastSavedCode[lang] = record.code;
      lastSavedAt[lang] = record.savedAt;
    } else {
      const starter = initialProblem.starterByLanguage[lang] ?? "";
      drafts[lang] = starter;
      lastSavedCode[lang] = starter;
      lastSavedAt[lang] = null;
    }
    hydratedLanguages[lang] = true;
  });

  function saveCurrentDraft() {
    if (isWorkspaceMode || !draftContext) return;
    const lang = language;
    const code = drafts[lang] ?? "";
    try {
      const record = saveDraft(
        { context: draftContext, problemId: problem.id, language: lang },
        code
      );
      lastSavedCode[lang] = code;
      lastSavedAt[lang] = record.savedAt;
      toasts.add({ type: "success", message: m.draft_saved() });
    } catch {
      toasts.add({ type: "error", message: "Failed to save draft." });
    }
  }

  function clearCurrentDraft() {
    if (isWorkspaceMode || !draftContext) return;
    if (typeof window === "undefined") return;
    if (!window.confirm(m.draft_clearConfirm())) return;
    const lang = language;
    clearDraft({ context: draftContext, problemId: problem.id, language: lang });
    const starter = initialProblem.starterByLanguage[lang] ?? "";
    drafts[lang] = starter;
    lastSavedCode[lang] = starter;
    lastSavedAt[lang] = null;
  }

  $effect(() => {
    if (isWorkspaceMode || !draftContext) return;
    return shortcuts.register({
      id: `editor-save:${problem.id}`,
      keys: ["Ctrl", "S"],
      description: m.shortcut_saveDraft(),
      category: "actions",
      allowInInputs: true,
      handler: () => saveCurrentDraft()
    });
  });

  let draftEnabled = $derived(!isWorkspaceMode && draftContext !== undefined);
  let isDirty = $derived(
    draftEnabled && drafts[language] !== (lastSavedCode[language] ?? "")
  );
  let currentLastSavedAt = $derived(draftEnabled ? (lastSavedAt[language] ?? null) : null);

  // Reset selection on language change: prefer `main.<ext>` as editable, fall back to first editable, then 0.
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

  // Block Run/Submit when there's nothing meaningful to send. Server enforces
  // sourceCode min(1) after trim; this just avoids the round-trip + the generic
  // "Submission failed." toast users see when validation rejects an empty body.
  let hasSubmittableSource = $derived.by(() => {
    if (isWorkspaceMode) {
      return currentWorkspaceFiles().some((f) => f.content.trim().length > 0);
    }
    return (drafts[language] ?? "").trim().length > 0;
  });

  // Cleanup: abort in-flight polls when the component is destroyed.
  let destroyed = false;
  let pollAbortController: AbortController | null = null;
  $effect(() => () => {
    destroyed = true;
    pollAbortController?.abort();
  });

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

  function runCasesForRequest(): { input: string; expectedOutput?: string }[] | undefined {
    if (isSpecialEnv) return undefined;
    // `expectedOutput: undefined` means "don't compare, just echo stdout"; preserve that distinction.
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
      // `sourceCode` is the first editable file's draft — kept alongside `sourceFiles` for legacy single-blob callers.
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
          contestId,
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
        contestId,
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
  class={isFullscreen
    ? "fixed inset-0 z-50 flex flex-col overflow-hidden bg-[color:var(--color-panel)]"
    : "flex h-full flex-col overflow-hidden border border-border bg-[color:var(--color-panel)]"}
>
  <!-- Top toolbar -->
  <div
    class="flex h-9 items-center justify-between border-b border-border-subtle bg-muted/40 px-3"
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
    <div class="flex items-center gap-2">
      {#if contestId}
        <span class="rounded-full bg-warning/15 px-2.5 py-0.5 text-caption font-medium text-warning">
          {m.editor_contestMode()}
        </span>
      {:else if assessment}
        <span class="rounded-full bg-info/15 px-2.5 py-0.5 text-caption font-medium text-info">
          {m.editor_assignmentMode()}
        </span>
      {/if}
      <button
        aria-label={m.editor_reset()}
        class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
        onclick={handleReset}
        title={m.editor_reset()}
        type="button"
      >
        <RotateCcw class="h-3.5 w-3.5" />
      </button>
      <button
        aria-label={isFullscreen ? m.editor_exitFullscreen() : m.editor_fullscreen()}
        class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
        onclick={toggleFullscreen}
        title={isFullscreen ? m.editor_exitFullscreen() : m.editor_fullscreen()}
        type="button"
      >
        {#if isFullscreen}
          <Minimize2 class="h-3.5 w-3.5" />
        {:else}
          <Maximize2 class="h-3.5 w-3.5" />
        {/if}
      </button>
    </div>
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
    class="flex items-center justify-between border-t border-border-subtle bg-muted/40 px-4 py-1"
  >
    <span class="text-caption font-medium text-muted-foreground tabular-nums">
      {new Intl.NumberFormat(currentLocale).format(currentSource.length)} {m.editor_chars()}
    </span>
    <div class="flex items-center gap-2">
      <button
        class="rounded-full border border-border px-3 py-1 text-caption font-medium text-foreground transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isRunning || availableLanguages.length === 0 || !hasSubmittableSource}
        onclick={() => void handleRun()}
        title={!hasSubmittableSource ? m.editor_emptySourceTooltip() : undefined}
        type="button"
      >
        {isRunning ? m.editor_running() : m.editor_run()}
      </button>
      <button
        class="rounded-full bg-success px-3 py-1 text-caption font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting || availableLanguages.length === 0 || !hasSubmittableSource}
        onclick={() => void handleSubmit()}
        title={!hasSubmittableSource ? m.editor_emptySourceTooltip() : undefined}
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
    aria-label={m.common_resizeBottomPanel()}
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
      {draftEnabled}
      {isDirty}
      lastSavedAt={currentLastSavedAt}
      onClearDraft={clearCurrentDraft}
    />
  </div>
</div>
