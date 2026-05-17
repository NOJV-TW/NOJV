<script lang="ts">
  import { untrack } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { getLocale } from "$lib/paraglide/runtime.js";
  import type { Language, SubmissionResult } from "@nojv/core";
  import type { ProblemDetail } from "$lib/types";
  import EditorCore from "./EditorCore.svelte";
  import EditorBottomPanel from "./EditorBottomPanel.svelte";
  import StudentProblemView from "./StudentProblemView.svelte";
  import EditorTopBar from "./EditorTopBar.svelte";
  import EditorActionBar from "./EditorActionBar.svelte";
  import EditorResizeHandle from "./EditorResizeHandle.svelte";
  import { type DraftContext } from "$lib/stores/code-draft";
  import {
    bindEscapeToExitFullscreen,
    createBottomResizeHandler,
    isSpecialEnvProblem,
    isWorkspaceProblem,
    persistLanguage,
    readPersistedLanguage,
    workspaceDraftKey
  } from "./editor-bindings";
  import { createDraftController } from "./use-draft.svelte";
  import { createEditorRunController } from "./use-editor-run.svelte";
  import { createWorkspaceFilesController } from "./use-workspace-files.svelte";

  interface Props {
    allowedLanguages?: Language[] | undefined;
    assessment?:
      | {
          assessmentId: string;
          courseId: string;
        }
      | undefined;
    contestId?: string | undefined;
    virtualContestId?: string | undefined;
    draftContext?: DraftContext | undefined;
    onSubmissionComplete?:
      | ((result: SubmissionResult, language: string, sourceCode: string) => void)
      | undefined;
    problem: ProblemDetail;
  }

  let {
    allowedLanguages,
    assessment,
    contestId,
    virtualContestId,
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
  let isFullscreen = $state(false);

  let isWorkspaceMode = $derived(isWorkspaceProblem(problem.type));
  let isSpecialEnv = $derived(isSpecialEnvProblem(problem.type));

  let workspaceFilesForLanguage = $derived(
    problem.workspaceFiles.filter((f) => f.language === language)
  );

  const workspaceFiles = createWorkspaceFilesController({
    initialFiles: initialProblem.workspaceFiles,
    filesForLanguage: () => workspaceFilesForLanguage,
    language: () => language
  });

  function handleReset() {
    if (typeof window === "undefined") return;
    if (!window.confirm(m.editor_resetConfirm())) return;
    if (isWorkspaceMode) {
      workspaceFiles.resetCurrentLanguage();
    } else {
      drafts[language] = initialProblem.starterByLanguage[language] ?? "";
    }
  }

  $effect(() => {
    if (!isFullscreen) return;
    return bindEscapeToExitFullscreen(() => (isFullscreen = false));
  });

  // Persist language choice to localStorage so the student sees the same
  // default when they come back to any problem.
  $effect(() => {
    persistLanguage(language);
  });

  const draftController = createDraftController({
    problemId: initialProblem.id,
    isWorkspaceMode: () => isWorkspaceMode,
    draftContext: () => draftContext,
    language: () => language,
    currentCode: () => drafts[language] ?? "",
    starterFor: (lang) => initialProblem.starterByLanguage[lang] ?? "",
    applyCode: (lang, code) => (drafts[lang] = code)
  });

  // Hydrate per-language draft on first visit + on language switch.
  $effect(() => {
    void language;
    draftController.hydrate();
  });

  $effect(() => draftController.registerShortcut());

  // Reset selection on language change: prefer `main.<ext>` as editable, fall back to first editable, then 0.
  $effect(() => {
    void language;
    workspaceFiles.resetSelectionForLanguage();
  });

  let currentSource = $derived(
    isWorkspaceMode ? workspaceFiles.selectedContent : drafts[language]
  );

  // Block Run/Submit when there's nothing meaningful to send. Server enforces
  // sourceCode min(1) after trim; this just avoids the round-trip + the generic
  // "Submission failed." toast users see when validation rejects an empty body.
  let hasSubmittableSource = $derived.by(() => {
    if (isWorkspaceMode) {
      return workspaceFilesForLanguage
        .filter((f) => f.visibility === "editable")
        .some(
          (f) =>
            (workspaceFiles.drafts[workspaceDraftKey(f.language, f.path)] ?? f.content).trim()
              .length > 0
        );
    }
    return (drafts[language] ?? "").trim().length > 0;
  });

  const runController = createEditorRunController({
    problemId: initialProblem.id,
    initialSamples: initialProblem.samples,
    language: () => language,
    isWorkspaceMode: () => isWorkspaceMode,
    isSpecialEnv: () => isSpecialEnv,
    drafts: () => drafts,
    workspaceDrafts: () => workspaceFiles.drafts,
    workspaceFiles: () => workspaceFilesForLanguage,
    assessment: () => assessment,
    contestId: () => contestId,
    virtualContestId: () => virtualContestId,
    onSubmissionComplete: (result, lang, src) => onSubmissionComplete?.(result, lang, src)
  });

  $effect(() => () => runController.markDestroyed());

  let bottomPanelHeight = $state(260);
  let outerContainer: HTMLDivElement = $state(null!);
  let isBottomResizing = $state(false);

  const startBottomResize = createBottomResizeHandler({
    getContainer: () => outerContainer,
    onHeightChange: (next) => (bottomPanelHeight = next),
    onResizingChange: (active) => (isBottomResizing = active)
  });
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
    onToggleFullscreen={() => (isFullscreen = !isFullscreen)}
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
        selectedIndex={workspaceFiles.selectedIndex}
        selectedContent={workspaceFiles.selectedContent}
        onselect={(index) => workspaceFiles.select(index)}
        onfilechange={(value) => workspaceFiles.applyChange(value)}
      />
    {/if}
  </div>

  <EditorActionBar
    charsLabel={new Intl.NumberFormat(currentLocale).format(currentSource.length)}
    isRunning={runController.isRunning}
    isSubmitting={runController.isSubmitting}
    {hasSubmittableSource}
    availableLanguageCount={availableLanguages.length}
    onRun={() => void runController.run()}
    onSubmit={() => void runController.submit()}
  />

  <EditorResizeHandle
    isResizing={isBottomResizing}
    height={bottomPanelHeight}
    onMouseDown={startBottomResize}
    onHeightChange={(next) => (bottomPanelHeight = next)}
  />
  <div class="shrink-0" style="height: {bottomPanelHeight}px">
    <EditorBottomPanel
      bind:runCases={runController.panelRunCases}
      isReadOnly={isSpecialEnv}
      tab={runController.bottomTab}
      runResult={runController.runResult}
      runStatus={runController.runStatus}
      runError={runController.runError}
      ontabchange={(next) => runController.setBottomTab(next)}
      draftEnabled={draftController.enabled}
      isDirty={draftController.isDirty}
      lastSavedAt={draftController.currentLastSavedAt}
      onClearDraft={() => draftController.clear()}
    />
  </div>
</div>
