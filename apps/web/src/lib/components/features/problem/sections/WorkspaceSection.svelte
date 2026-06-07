<script lang="ts">
  import { untrack } from "svelte";
  import {
    entryFileNameFor,
    languageExtension,
    supportedLanguages,
    type Language,
  } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import WorkspaceModeSection, {
    type WorkspaceMode,
  } from "$lib/components/features/problem/workspace/WorkspaceModeSection.svelte";
  import WorkspaceRuntimeSection from "$lib/components/features/problem/workspace/WorkspaceRuntimeSection.svelte";
  import WorkspaceLanguagesSection from "$lib/components/features/problem/workspace/WorkspaceLanguagesSection.svelte";
  import WorkspaceFilesSection from "$lib/components/features/problem/workspace/WorkspaceFilesSection.svelte";
  import WorkspaceSaveBar from "$lib/components/features/problem/workspace/WorkspaceSaveBar.svelte";
  import type { WorkspaceFile } from "$lib/components/features/problem/workspace/WorkspaceFileEditor.svelte";

  export type { WorkspaceMode };

  export interface WorkspaceSectionPayload {
    runtime: {
      timeLimitMs: number;
      memoryLimitMb: number;
      env: Record<string, string>;
    };
    allowedLanguages: Language[];
    files: (WorkspaceFile & { language: Language })[];
    type: WorkspaceMode;
  }

  interface Props {
    initial: WorkspaceSectionPayload;
    ondirtychange?: (dirty: boolean) => void;
    onsave?: (payload: WorkspaceSectionPayload) => Promise<void> | void;
    onUploadFile?: (file: File, language: Language) => Promise<void>;
  }

  let { initial, ondirtychange, onsave, onUploadFile }: Props = $props();

  let timeLimitMs = $state(untrack(() => initial.runtime.timeLimitMs));
  let memoryLimitMb = $state(untrack(() => initial.runtime.memoryLimitMb));
  let envRows = $state<{ key: string; value: string }[]>(
    untrack(() => Object.entries(initial.runtime.env).map(([key, value]) => ({ key, value }))),
  );

  let mode = $state<WorkspaceMode>(untrack(() => initial.type));

  let allowedLanguages = $state<Language[]>(
    untrack(() =>
      initial.allowedLanguages.length > 0
        ? [...initial.allowedLanguages]
        : [...supportedLanguages],
    ),
  );

  let activeLang = $state<Language>(
    untrack(() => allowedLanguages[0] ?? supportedLanguages[0] ?? "c"),
  );
  let files = $state<(WorkspaceFile & { language: Language })[]>(
    untrack(() => initial.files.map((f) => ({ ...f }))),
  );
  let selectedIndex = $state(0);

  $effect(() => {
    if (allowedLanguages.length === 0) return;
    if (!allowedLanguages.includes(activeLang)) {
      activeLang = allowedLanguages[0]!;
      selectedIndex = 0;
    }
  });

  let filesForActiveLang = $derived(
    files
      .map((f, i) => ({ file: f, index: i }))
      .filter((entry) => entry.file.language === activeLang),
  );

  function hasEntryFileForLanguage(lang: Language): boolean {
    const entryName = entryFileNameFor(lang);
    return files.some(
      (f) => f.language === lang && f.path === entryName && f.visibility === "editable",
    );
  }

  let missingEntryLanguages = $derived(
    allowedLanguages.filter((lang) => !hasEntryFileForLanguage(lang)),
  );

  function addFile() {
    const entryName = entryFileNameFor(activeLang);
    const hasEntry = hasEntryFileForLanguage(activeLang);
    const activeLangCount = files.filter((f) => f.language === activeLang).length;
    const defaultPath = hasEntry
      ? `file${String(activeLangCount + 1)}.${languageExtension(activeLang)}`
      : entryName;
    const newFile: WorkspaceFile & { language: Language } = {
      language: activeLang,
      path: defaultPath,
      content: "",
      description: "",
      visibility: "editable",
      orderIndex: files.length,
    };
    files = [...files, newFile];
    selectedIndex = filesForActiveLang.length - 1;
  }

  function deleteFile(globalIndex: number) {
    files = files.filter((_, i) => i !== globalIndex);
    selectedIndex = Math.max(0, selectedIndex - 1);
  }

  function updateFile(globalIndex: number, updated: WorkspaceFile) {
    files = files.map((f, i) => (i === globalIndex ? { ...updated, language: f.language } : f));
  }

  let saving = $state(false);
  let saveMessage = $state("");

  function buildPayload(): WorkspaceSectionPayload {
    const env: Record<string, string> = {};
    for (const row of envRows) {
      if (row.key.trim() !== "") {
        env[row.key] = row.value;
      }
    }
    return {
      runtime: { timeLimitMs, memoryLimitMb, env },
      allowedLanguages,
      files,
      type: mode,
    };
  }

  let initialSnapshot = JSON.stringify(buildPayload());
  $effect(() => {
    const current = JSON.stringify(buildPayload());
    ondirtychange?.(current !== initialSnapshot);
  });

  function validateBeforeSave(): string | null {
    for (const lang of allowedLanguages) {
      const entryName = entryFileNameFor(lang);
      const langFiles = files.filter((f) => f.language === lang);
      if (langFiles.length === 0) continue;
      const editableEntries = langFiles.filter(
        (f) => f.path === entryName && f.visibility === "editable",
      );
      if (editableEntries.length !== 1) {
        return m.workspace_mustHaveMainFile({ filename: entryName });
      }
    }
    if (mode === "multi_file" && missingEntryLanguages.length > 0) {
      return m.admin_workspaceMissingTemplatesBanner({
        languages: missingEntryLanguages.join(", "),
      });
    }
    return null;
  }

  async function handleSave() {
    const validationError = validateBeforeSave();
    if (validationError !== null) {
      saveMessage = validationError;
      return;
    }
    saving = true;
    saveMessage = "";
    try {
      await onsave?.(buildPayload());
      initialSnapshot = JSON.stringify(buildPayload());
      saveMessage = "saved";
    } catch (err) {
      saveMessage = "error";
      console.error(err);
    } finally {
      saving = false;
    }
  }

  let activeSelected = $derived(
    filesForActiveLang[selectedIndex]?.index ?? filesForActiveLang[0]?.index ?? -1,
  );

  let filesTitle = $derived(
    mode === "multi_file"
      ? m.admin_workspaceFilesTitleMultiFile()
      : m.admin_workspaceFilesTitleFullSource(),
  );
  let filesHint = $derived(
    mode === "multi_file"
      ? m.admin_workspaceFilesHintMultiFile()
      : m.admin_workspaceFilesHintFullSource(),
  );

  let activeEntryFileName = $derived(entryFileNameFor(activeLang));
  let activeLangHasEntry = $derived(hasEntryFileForLanguage(activeLang));
  let activeLangIsEmpty = $derived(filesForActiveLang.length === 0);
</script>

<div class="space-y-6">
  <WorkspaceModeSection bind:mode />
  <WorkspaceRuntimeSection bind:timeLimitMs bind:memoryLimitMb bind:envRows />
  <WorkspaceLanguagesSection bind:allowedLanguages {mode} {hasEntryFileForLanguage} />
  <WorkspaceFilesSection
    {mode}
    {allowedLanguages}
    {activeLang}
    {files}
    bind:selectedIndex
    {missingEntryLanguages}
    {activeEntryFileName}
    {activeLangHasEntry}
    {activeLangIsEmpty}
    {filesTitle}
    {filesHint}
    {filesForActiveLang}
    {activeSelected}
    {hasEntryFileForLanguage}
    onChangeActiveLang={(lang) => {
      activeLang = lang;
      selectedIndex = 0;
    }}
    onAddFile={addFile}
    onUpdateFile={updateFile}
    onDeleteFile={deleteFile}
    {onUploadFile}
  />
  <WorkspaceSaveBar {saving} {saveMessage} onSave={() => void handleSave()} />
</div>
