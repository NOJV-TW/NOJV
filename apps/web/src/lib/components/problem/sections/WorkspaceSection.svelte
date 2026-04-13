<script lang="ts">
  import { untrack } from "svelte";
  import {
    entryFileNameFor,
    languageExtension,
    supportedLanguages,
    type Language,
    type ProblemType
  } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { inputClassName } from "$lib/utils";
  import WorkspaceFileList from "$lib/components/problem/workspace/WorkspaceFileList.svelte";
  import WorkspaceFileEditor, {
    type WorkspaceFile
  } from "$lib/components/problem/workspace/WorkspaceFileEditor.svelte";

  // Only the two workspace-capable types are user-switchable from here;
  // special_env has its own Advanced Mode editor.
  export type WorkspaceMode = Exclude<ProblemType, "special_env">;

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
  }

  let { initial, ondirtychange, onsave }: Props = $props();

  // The component is a scratchpad seeded from `initial`; once the user starts
  // editing, external changes to `initial` must not clobber in-progress state.
  // Wrap every read of `initial` in untrack() to capture a one-shot snapshot.

  // ─── Runtime ──────────────────────────────────────────────────────
  let timeLimitMs = $state(untrack(() => initial.runtime.timeLimitMs));
  let memoryLimitMb = $state(untrack(() => initial.runtime.memoryLimitMb));
  let envRows = $state<{ key: string; value: string }[]>(
    untrack(() => Object.entries(initial.runtime.env).map(([key, value]) => ({ key, value })))
  );

  function addEnvRow() {
    envRows = [...envRows, { key: "", value: "" }];
  }
  function removeEnvRow(i: number) {
    envRows = envRows.filter((_, idx) => idx !== i);
  }

  // ─── Problem type ─────────────────────────────────────────────────
  let mode = $state<WorkspaceMode>(untrack(() => initial.type));

  // ─── Allowed languages ────────────────────────────────────────────
  let allowedLanguages = $state<Language[]>(
    untrack(() =>
      initial.allowedLanguages.length > 0
        ? [...initial.allowedLanguages]
        : [...supportedLanguages]
    )
  );

  function toggleLanguage(lang: Language) {
    allowedLanguages = allowedLanguages.includes(lang)
      ? allowedLanguages.filter((l) => l !== lang)
      : [...allowedLanguages, lang];
  }

  // ─── Files ────────────────────────────────────────────────────────
  let activeLang = $state<Language>(
    untrack(() => allowedLanguages[0] ?? supportedLanguages[0] ?? "c")
  );
  let files = $state<(WorkspaceFile & { language: Language })[]>(
    untrack(() => initial.files.map((f) => ({ ...f })))
  );
  let selectedIndex = $state(0);

  // Keep activeLang in sync with allowedLanguages — if the user un-ticks
  // the current language, fall back to the first available one so the
  // Files panel doesn't stay pointed at an absent language.
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
      .filter((entry) => entry.file.language === activeLang)
  );

  function hasEntryFileForLanguage(lang: Language): boolean {
    const entryName = entryFileNameFor(lang);
    return files.some(
      (f) => f.language === lang && f.path === entryName && f.visibility === "editable"
    );
  }

  let missingEntryLanguages = $derived(
    allowedLanguages.filter((lang) => !hasEntryFileForLanguage(lang))
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
      orderIndex: files.length
    };
    files = [...files, newFile];
    // `filesForActiveLang` is a $derived that recomputes on read, so after
    // the append its length reflects the new file. The appended file is the
    // last active-lang entry, so its local index is length-1.
    selectedIndex = filesForActiveLang.length - 1;
  }

  function deleteFile(globalIndex: number) {
    files = files.filter((_, i) => i !== globalIndex);
    selectedIndex = Math.max(0, selectedIndex - 1);
  }

  function updateFile(globalIndex: number, updated: WorkspaceFile) {
    files = files.map((f, i) =>
      i === globalIndex ? { ...updated, language: f.language } : f
    );
  }

  // ─── Save ─────────────────────────────────────────────────────────
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
      type: mode
    };
  }

  let initialSnapshot = JSON.stringify(buildPayload());
  $effect(() => {
    const current = JSON.stringify(buildPayload());
    ondirtychange?.(current !== initialSnapshot);
  });

  function validateBeforeSave(): string | null {
    // Every language that DOES have files needs a well-formed entry
    // (single editable main.<ext>). Applies in both modes because the
    // backend mutation enforces the same invariant.
    for (const lang of allowedLanguages) {
      const entryName = entryFileNameFor(lang);
      const langFiles = files.filter((f) => f.language === lang);
      if (langFiles.length === 0) continue;
      const editableEntries = langFiles.filter(
        (f) => f.path === entryName && f.visibility === "editable"
      );
      if (editableEntries.length !== 1) {
        return m.workspace_mustHaveMainFile({ filename: entryName });
      }
    }
    // Multi-file adds: every allowed language must actually have an entry.
    if (mode === "multi_file" && missingEntryLanguages.length > 0) {
      return m.admin_workspaceMissingTemplatesBanner({
        languages: missingEntryLanguages.join(", ")
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
    filesForActiveLang[selectedIndex]?.index ?? filesForActiveLang[0]?.index ?? -1
  );

  let filesTitle = $derived(
    mode === "multi_file"
      ? m.admin_workspaceFilesTitleMultiFile()
      : m.admin_workspaceFilesTitleFullSource()
  );
  let filesHint = $derived(
    mode === "multi_file"
      ? m.admin_workspaceFilesHintMultiFile()
      : m.admin_workspaceFilesHintFullSource()
  );

  let activeEntryFileName = $derived(entryFileNameFor(activeLang));
  let activeLangHasEntry = $derived(hasEntryFileForLanguage(activeLang));
  let activeLangIsEmpty = $derived(filesForActiveLang.length === 0);

  function createEntryFile() {
    // addFile() auto-names as main.<ext> when no entry exists for the
    // active language, so we can just delegate.
    addFile();
  }
</script>

<div class="space-y-6">
  <!-- ─── Problem type ───────────────────────────────── -->
  <section class="rounded-xl border border-border-subtle p-4">
    <h3 class="text-body-sm font-semibold">{m.admin_workspaceModeTitle()}</h3>
    <p class="mt-0.5 text-caption text-muted-foreground">{m.admin_workspaceModeHint()}</p>

    <div class="mt-3 grid gap-3 md:grid-cols-2">
      {#each [
        {
          id: "full_source" as const,
          title: m.admin_workspaceModeFullSourceTitle(),
          desc: m.admin_workspaceModeFullSourceDesc()
        },
        {
          id: "multi_file" as const,
          title: m.admin_workspaceModeMultiFileTitle(),
          desc: m.admin_workspaceModeMultiFileDesc()
        }
      ] as option (option.id)}
        <button
          type="button"
          class="flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-[transform,box-shadow,background-color,border-color] duration-fast ease-out-soft hover:-translate-y-0.5 {mode ===
          option.id
            ? 'border-primary bg-primary/5 shadow-rest'
            : 'border-border bg-[color:var(--color-panel)] hover:border-primary/50'}"
          aria-pressed={mode === option.id}
          onclick={() => (mode = option.id)}
        >
          <span class="flex items-center gap-2 text-body-sm font-semibold">
            <span
              class="flex size-4 items-center justify-center rounded-full border-2 {mode ===
              option.id
                ? 'border-primary'
                : 'border-border'}"
              aria-hidden="true"
            >
              {#if mode === option.id}
                <span class="size-2 rounded-full bg-primary"></span>
              {/if}
            </span>
            {option.title}
          </span>
          <span class="text-caption leading-relaxed text-muted-foreground">{option.desc}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- ─── Runtime ────────────────────────────────────── -->
  <section class="rounded-xl border border-border-subtle p-4">
    <h3 class="text-body-sm font-semibold">{m.admin_runtime()}</h3>
    <div class="mt-3 grid gap-3 md:grid-cols-2">
      <label class="text-caption text-muted-foreground">
        <span>{m.admin_timeLimitMs()}</span>
        <input
          class={inputClassName}
          type="number"
          min="100"
          max="30000"
          bind:value={timeLimitMs}
        />
      </label>
      <label class="text-caption text-muted-foreground">
        <span>{m.admin_memoryLimitMb()}</span>
        <input
          class={inputClassName}
          type="number"
          min="16"
          max="1024"
          bind:value={memoryLimitMb}
        />
      </label>
    </div>

    <div class="mt-4">
      <div class="flex items-center justify-between">
        <span class="text-caption font-semibold text-muted-foreground">{m.admin_envVars()}</span>
        <button
          type="button"
          class="text-caption text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-foreground"
          onclick={addEnvRow}
        >
          {m.admin_envAdd()}
        </button>
      </div>
      {#if envRows.length === 0}
        <p class="mt-2 text-caption text-muted-foreground">{m.admin_envNone()}</p>
      {:else}
        <div class="mt-2 space-y-2">
          {#each envRows as row, i (`env-${String(i)}`)}
            <div class="flex gap-2">
              <input
                class="{inputClassName} flex-1"
                type="text"
                placeholder="KEY"
                bind:value={row.key}
              />
              <input
                class="{inputClassName} flex-1"
                type="text"
                placeholder="value"
                bind:value={row.value}
              />
              <button
                type="button"
                class="rounded border border-border px-2 text-caption text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-destructive"
                onclick={() => removeEnvRow(i)}
                aria-label={m.admin_envRemove()}
              >
                &times;
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </section>

  <!-- ─── Allowed languages ──────────────────────────── -->
  <section class="rounded-xl border border-border-subtle p-4">
    <h3 class="text-body-sm font-semibold">{m.admin_allowedLanguages()}</h3>
    <p class="mt-0.5 text-caption text-muted-foreground">{m.admin_allowedLanguagesHint()}</p>
    <div class="mt-3 flex flex-wrap gap-2">
      {#each supportedLanguages as lang (lang)}
        {@const checked = allowedLanguages.includes(lang)}
        {@const missingTemplate = mode === "multi_file" && checked && !hasEntryFileForLanguage(lang)}
        <label
          class="flex items-center gap-2 rounded-full border px-3 py-1 text-caption transition-[background-color,border-color] duration-fast ease-out-soft {checked
            ? missingTemplate
              ? 'border-warning/60 bg-warning/10 text-warning'
              : 'border-primary bg-primary/5 text-foreground'
            : 'border-border text-muted-foreground'}"
        >
          <input
            type="checkbox"
            class="accent-primary"
            {checked}
            onchange={() => toggleLanguage(lang)}
          />
          <span>{lang}</span>
          {#if missingTemplate}
            <span
              class="inline-flex size-1.5 rounded-full bg-warning"
              aria-label={m.admin_workspaceLanguageMissing()}
            ></span>
          {/if}
        </label>
      {/each}
    </div>
  </section>

  <!-- ─── Files ──────────────────────────────────────── -->
  <section class="rounded-xl border border-border-subtle p-4">
    <div>
      <h3 class="text-body-sm font-semibold">{filesTitle}</h3>
      <p class="mt-0.5 text-caption leading-relaxed text-muted-foreground">{filesHint}</p>
    </div>

    {#if mode === "multi_file" && missingEntryLanguages.length > 0}
      <div
        class="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-warning"
        role="status"
      >
        <p class="font-semibold">
          {m.admin_workspaceMissingTemplatesBanner({
            languages: missingEntryLanguages.join(", ")
          })}
        </p>
        <p class="mt-0.5 text-warning/80">{m.admin_workspaceMissingTemplatesPrompt()}</p>
      </div>
    {/if}

    {#if allowedLanguages.length === 0}
      <div
        class="mt-4 rounded-lg border border-dashed border-border-subtle p-6 text-center text-body-sm text-muted-foreground"
      >
        {m.admin_workspaceNoLanguagesSelected()}
      </div>
    {:else}
      <!-- Language tabs -->
      <div class="mt-4 -mx-1 flex flex-wrap items-center gap-1 border-b border-border-subtle pb-2">
        {#each allowedLanguages as lang (lang)}
          {@const isActive = lang === activeLang}
          {@const needsTemplate = mode === "multi_file" && !hasEntryFileForLanguage(lang)}
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-caption font-medium transition-[background-color,color] duration-fast ease-out-soft {isActive
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
            onclick={() => {
              activeLang = lang;
              selectedIndex = 0;
            }}
          >
            <span>{lang}</span>
            {#if mode === "multi_file"}
              <span
                class="inline-flex size-1.5 rounded-full {needsTemplate
                  ? 'bg-warning'
                  : 'bg-success'}"
                aria-label={needsTemplate
                  ? m.admin_workspaceLanguageMissing()
                  : m.admin_workspaceLanguageReady()}
              ></span>
            {/if}
          </button>
        {/each}
      </div>

      <!-- File list + editor/empty state -->
      <div class="mt-3 grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <WorkspaceFileList
          files={filesForActiveLang.map((e) => e.file)}
          selectedIndex={filesForActiveLang.findIndex((e) => e.index === activeSelected)}
          onselect={(localIdx) => {
            const entry = filesForActiveLang[localIdx];
            if (entry) selectedIndex = localIdx;
          }}
          onadd={addFile}
        />
        {#if activeSelected >= 0 && files[activeSelected]}
          {@const current = files[activeSelected]}
          <WorkspaceFileEditor
            file={current}
            language={activeLang}
            onchange={(updated) => updateFile(activeSelected, updated)}
            ondelete={() => deleteFile(activeSelected)}
          />
        {:else}
          <div
            class="flex min-h-[240px] flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border-subtle p-8 text-center"
          >
            <p class="max-w-md text-body-sm leading-relaxed text-muted-foreground">
              {#if mode === "multi_file"}
                {m.admin_workspaceEmptyMultiFile({
                  language: activeLang,
                  filename: activeEntryFileName
                })}
              {:else}
                {m.admin_workspaceEmptyFullSource({ language: activeLang })}
              {/if}
            </p>
            {#if activeLangIsEmpty || !activeLangHasEntry}
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-body-sm font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5"
                onclick={createEntryFile}
              >
                {m.admin_workspaceCreateMainFile({ filename: activeEntryFileName })}
              </button>
            {:else}
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-caption font-medium text-muted-foreground transition-[color,border-color] duration-fast ease-out-soft hover:border-primary hover:text-primary"
                onclick={addFile}
              >
                {m.admin_workspaceAddOtherFile()}
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </section>

  <!-- ─── Save ───────────────────────────────────────── -->
  <div class="flex items-center justify-end gap-3">
    <button
      type="button"
      class="inline-flex rounded-full bg-primary px-5 py-3 text-body-sm font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
      disabled={saving}
      onclick={() => void handleSave()}
    >
      {saving ? m.admin_savingWorkspace() : m.admin_saveWorkspace()}
    </button>
    {#if saveMessage === "saved"}
      <span class="text-body-sm text-success">{m.admin_saved()}</span>
    {:else if saveMessage === "error"}
      <span class="text-body-sm text-destructive">{m.admin_saveFailed()}</span>
    {:else if saveMessage !== ""}
      <span class="text-body-sm text-destructive">{saveMessage}</span>
    {/if}
  </div>
</div>
