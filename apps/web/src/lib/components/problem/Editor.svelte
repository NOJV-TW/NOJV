<script lang="ts">
  import { untrack } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { getLocale } from "$lib/paraglide/runtime.js";
  import { type Language, type SubmissionResult } from "@nojv/core";
  import type { ProblemDetail } from "$lib/types";
  import EditorCore from "./EditorCore.svelte";
  import EditorBottomPanel from "./EditorBottomPanel.svelte";
  import StudentProblemView from "./StudentProblemView.svelte";
  import EditorTopBar from "./editors/EditorTopBar.svelte";
  import EditorActionBar from "./editors/EditorActionBar.svelte";
  import {
    executeSubmission,
    type SubmissionWorkspaceFile
  } from "$lib/services/submission-service";
  import {
    clearDraft,
    loadDraft,
    saveDraft,
    type DraftContext
  } from "$lib/stores/code-draft";
  import { shortcuts } from "$lib/stores/shortcuts.svelte";
  import { toasts } from "$lib/stores/toast";
  import {
    bindEscapeToExitFullscreen,
    createBottomResizeHandler,
    isSpecialEnvProblem,
    isWorkspaceProblem,
    persistLanguage,
    pickInitialWorkspaceIndex,
    projectRunCasesForRequest,
    projectWorkspaceFilesForSubmit,
    readPersistedLanguage,
    seedWorkspaceDrafts,
    workspaceDraftKey,
    type WorkspaceFile
  } from "./editors/editor-bindings";

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

  let language = $state<Language>(readPersistedLanguage());
  let drafts = $state({ ...initialProblem.starterByLanguage });
  let lastSavedCode = $state<Record<string, string>>({});
  let lastSavedAt = $state<Record<string, number | null>>({});
  let hydratedLanguages = $state<Record<string, boolean>>({});
  let isRunning = $state(false);
  let isSubmitting = $state(false);
  let isFullscreen = $state(false);

  let isWorkspaceMode = $derived(isWorkspaceProblem(problem.type));
  let isSpecialEnv = $derived(isSpecialEnvProblem(problem.type));

  let workspaceDrafts = $state<Record<string, string>>(
    seedWorkspaceDrafts(initialProblem.workspaceFiles)
  );
  let selectedWorkspaceIndex = $state(0);

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
    return bindEscapeToExitFullscreen(() => (isFullscreen = false));
  });

  // Bottom panel state — tab + last-run snapshot live here because the
  // Run/Submit flow below drives them.
  let bottomTab = $state<"testcase" | "result">("testcase");
  let runResult = $state<SubmissionResult | null>(null);
  let runStatus = $state<string | null>(null);
  let runError = $state<string | null>(null);

  let panelRunCases = $state<{ input: string; expectedOutput: string }[]>(
    initialProblem.samples.map((s) => ({ input: s.input, expectedOutput: s.output }))
  );

  // Persist language choice to localStorage so the student sees the same
  // default when they come back to any problem.
  $effect(() => {
    persistLanguage(language);
  });

  let workspaceFilesForLanguage = $derived(
    problem.workspaceFiles.filter((f) => f.language === language)
  );

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
    selectedWorkspaceIndex = pickInitialWorkspaceIndex(workspaceFilesForLanguage, language);
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

  function currentWorkspaceFiles(): SubmissionWorkspaceFile[] {
    return projectWorkspaceFilesForSubmit(workspaceFilesForLanguage, workspaceDrafts);
  }

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
  let isBottomResizing = $state(false);

  const startBottomResize = createBottomResizeHandler({
    getContainer: () => outerContainer,
    onHeightChange: (next) => (bottomPanelHeight = next),
    onResizingChange: (active) => (isBottomResizing = active)
  });

  function runCasesForRequest(): { input: string; expectedOutput?: string }[] | undefined {
    if (isSpecialEnv) return undefined;
    return projectRunCasesForRequest(panelRunCases);
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
    : "flex h-full flex-col overflow-hidden bg-[color:var(--color-panel)]"}
>
  <EditorTopBar
    {language}
    {allowedLanguages}
    problemType={problem.type}
    workspaceFiles={problem.workspaceFiles}
    {contestId}
    {assessment}
    {isFullscreen}
    onLanguageChange={(next) => (language = next)}
    onAvailableChange={(available) => (availableLanguages = available)}
    onReset={handleReset}
    onToggleFullscreen={toggleFullscreen}
  />

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
      isHidden={isWorkspaceMode}
      onchange={(value) => (drafts[language] = value)}
    />
    {#if isWorkspaceMode}
      <StudentProblemView
        files={workspaceFilesForLanguage}
        selectedIndex={selectedWorkspaceIndex}
        selectedContent={selectedWorkspaceContent}
        onselect={(index) => (selectedWorkspaceIndex = index)}
        onfilechange={handleWorkspaceFileChange}
      />
    {/if}
  </div>

  <EditorActionBar
    charsLabel={new Intl.NumberFormat(currentLocale).format(currentSource.length)}
    {isRunning}
    {isSubmitting}
    {hasSubmittableSource}
    availableLanguageCount={availableLanguages.length}
    onRun={() => void handleRun()}
    onSubmit={() => void handleSubmit()}
  />

  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- Horizontal resize handle between editor area and bottom panel -->
  <div
    class="group flex h-2 shrink-0 cursor-row-resize flex-col items-stretch justify-center outline-none"
    role="separator"
    aria-orientation="horizontal"
    aria-label={m.common_resizeBottomPanel()}
    tabindex="0"
    onmousedown={startBottomResize}
    onkeydown={(e) => {
      if (e.key === "ArrowUp") bottomPanelHeight = Math.min(800, bottomPanelHeight + 16);
      if (e.key === "ArrowDown") bottomPanelHeight = Math.max(120, bottomPanelHeight - 16);
    }}
  >
    <span
      aria-hidden="true"
      class="h-px transition-colors duration-fast {isBottomResizing
        ? 'bg-primary'
        : 'bg-transparent group-hover:bg-primary/60 group-focus-visible:bg-primary/60'}"
    ></span>
  </div>
  <div class="shrink-0" style="height: {bottomPanelHeight}px">
    <EditorBottomPanel
      bind:runCases={panelRunCases}
      isReadOnly={isSpecialEnv}
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
