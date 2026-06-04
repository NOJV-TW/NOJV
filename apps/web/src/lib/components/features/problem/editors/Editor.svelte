<script lang="ts">
  import { untrack } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import type { Language, SubmissionResult } from "@nojv/core";
  import type { ProblemDetail } from "$lib/types";
  import EditorCore from "./EditorCore.svelte";
  import EditorBottomPanel from "./EditorBottomPanel.svelte";
  import StudentProblemView from "./StudentProblemView.svelte";
  import EditorTopBar from "./EditorTopBar.svelte";
  import EditorActionBar from "./EditorActionBar.svelte";
  import EditorResizeHandle from "./EditorResizeHandle.svelte";
  import { type DraftContext } from "$lib/stores/code-draft";
  import { shortcuts } from "$lib/stores/shortcuts.svelte";
  import {
    bindEscapeToExitFullscreen,
    createBottomResizeHandler,
    isSpecialEnvProblem,
    isWorkspaceProblem,
    persistLanguage,
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
    initialLanguage?: Language | undefined;
    onSubmissionDispatched?: ((submissionId: string, language: string) => void) | undefined;
    onSubmissionComplete?:
      | ((
          submissionId: string,
          result: SubmissionResult,
          language: string,
          sourceCode: string
        ) => void)
      | undefined;
    attemptsExhausted?: boolean | undefined;
    problem: ProblemDetail;
  }

  let {
    allowedLanguages,
    assessment,
    contestId,
    virtualContestId,
    draftContext,
    initialLanguage,
    onSubmissionDispatched,
    onSubmissionComplete,
    attemptsExhausted = false,
    problem
  }: Props = $props();
  const initialProblem = untrack(() => problem);

  let availableLanguages = $state<Language[]>([]);

  function resolveInitialLanguage(): Language {
    const base = initialLanguage ?? "cpp";
    if (allowedLanguages && allowedLanguages.length > 0 && !allowedLanguages.includes(base)) {
      return allowedLanguages[0]!;
    }
    return base;
  }

  let language = $state<Language>(resolveInitialLanguage());
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

  $effect(() => {
    void language;
    draftController.hydrate();
  });

  $effect(() => draftController.registerShortcut());

  $effect(() => {
    void drafts[language];
    draftController.scheduleAutosave();
  });

  $effect(() => () => draftController.dispose());

  $effect(() => {
    void language;
    workspaceFiles.resetSelectionForLanguage();
  });

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
    onSubmissionDispatched: (id, lang) => onSubmissionDispatched?.(id, lang),
    onSubmissionComplete: (id, result, lang, src) =>
      onSubmissionComplete?.(id, result, lang, src)
  });

  $effect(() => () => runController.markDestroyed());

  $effect(() =>
    shortcuts.register({
      id: `editor-submit:${initialProblem.id}`,
      keys: ["Ctrl", "Enter"],
      description: m.shortcut_submit(),
      category: "actions",
      allowInInputs: true,
      handler: () => {
        if (!runController.isSubmitting && hasSubmittableSource) void runController.submit();
      }
    })
  );

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
    ? "fixed inset-0 z-50 flex flex-col overflow-hidden bg-[color:var(--color-background)]"
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
    isRunning={runController.isRunning}
    isSubmitting={runController.isSubmitting}
    {hasSubmittableSource}
    {attemptsExhausted}
    availableLanguageCount={availableLanguages.length}
    draftEnabled={draftController.enabled}
    isDirty={draftController.isDirty}
    lastSavedAt={draftController.currentLastSavedAt}
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
    />
  </div>
</div>
