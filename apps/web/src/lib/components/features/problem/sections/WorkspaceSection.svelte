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

  type WorkspaceSnapshot = Omit<WorkspaceSectionPayload, "allowedLanguages">;

  interface Props {
    initial: WorkspaceSnapshot;
    modeLocked?: boolean;
    ondirtychange?: (dirty: boolean) => void;
    onsave: (payload: WorkspaceSectionPayload) => Promise<void>;
  }

  let { initial, modeLocked = false, ondirtychange, onsave }: Props = $props();

  let timeLimitMs = $state(0);
  let memoryLimitMb = $state(0);
  let envRows = $state<{ key: string; value: string }[]>([]);
  let mode = $state<WorkspaceMode>("multi_file");
  let allowedLanguages = $state<Language[]>([]);
  let activeLang = $state<Language>(supportedLanguages[0] ?? "c");
  let files = $state<(WorkspaceFile & { language: Language })[]>([]);
  let selectedIndex = $state(0);
  let initialSnapshot = $state("");

  function isEditableEntry(file: WorkspaceFile & { language: Language }, lang: Language) {
    return (
      file.language === lang &&
      file.path === entryFileNameFor(lang) &&
      file.visibility === "editable"
    );
  }

  function loadPersisted(source: WorkspaceSnapshot) {
    timeLimitMs = source.runtime.timeLimitMs;
    memoryLimitMb = source.runtime.memoryLimitMb;
    envRows = Object.entries(source.runtime.env).map(([key, value]) => ({ key, value }));
    mode = source.type;
    files = source.files.map((f) => ({ ...f }));
    allowedLanguages = supportedLanguages.filter((lang) =>
      files.some((f) => isEditableEntry(f, lang)),
    );
    initialSnapshot = JSON.stringify(buildPayload());
  }

  loadPersisted(untrack(() => initial));

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
    return files.some((f) => isEditableEntry(f, lang));
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

  async function addUploadedFile(file: File, language: Language) {
    const content = await file.text();
    const existing = files.findIndex((f) => f.language === language && f.path === file.name);
    if (existing >= 0) {
      updateFile(existing, { ...files[existing]!, content });
    } else {
      files = [
        ...files,
        {
          language,
          path: file.name,
          content,
          description: "",
          visibility: "editable",
          orderIndex: files.length,
        },
      ];
    }
    selectedIndex = filesForActiveLang.findIndex((entry) => entry.file.path === file.name);
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
      files: files.filter((f) => allowedLanguages.includes(f.language)),
      type: mode,
    };
  }

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

  export function save() {
    void handleSave();
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
      const payload = buildPayload();
      await onsave(payload);
      loadPersisted(payload);
      saveMessage = "saved";
    } catch (err) {
      saveMessage = err instanceof Error ? err.message : "error";
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
  <WorkspaceModeSection bind:mode locked={modeLocked} />
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
    onUploadFile={addUploadedFile}
  />
  {#if saving || saveMessage}
    <div class="flex items-center justify-end gap-3">
      {#if saving}
        <span class="text-body-sm text-muted-foreground">{m.common_saving()}</span>
      {:else if saveMessage === "saved"}
        <span class="text-body-sm text-success">{m.admin_saved()}</span>
      {:else if saveMessage === "error"}
        <span class="text-body-sm text-destructive">{m.admin_saveFailed()}</span>
      {:else if saveMessage !== ""}
        <span class="text-body-sm text-destructive">{saveMessage}</span>
      {/if}
    </div>
  {/if}
</div>
