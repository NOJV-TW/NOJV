<script lang="ts">
  import { untrack } from "svelte";
  import {
    entryFileNameFor,
    languageExtension,
    supportedLanguages,
    type Language
  } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { inputClassName, monoTextareaClassName } from "$lib/utils";
  import WorkspaceFileList from "$lib/components/problem/workspace/WorkspaceFileList.svelte";
  import WorkspaceFileEditor, {
    type WorkspaceFile
  } from "$lib/components/problem/workspace/WorkspaceFileEditor.svelte";

  export interface WorkspaceSectionPayload {
    runtime: {
      timeLimitMs: number;
      memoryLimitMb: number;
      env: Record<string, string>;
    };
    allowedLanguages: Language[];
    files: (WorkspaceFile & { language: Language })[];
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

  let filesForActiveLang = $derived(
    files
      .map((f, i) => ({ file: f, index: i }))
      .filter((entry) => entry.file.language === activeLang)
  );

  function addFile() {
    const entryName = entryFileNameFor(activeLang);
    const hasEntry = files.some(
      (f) => f.language === activeLang && f.path === entryName
    );
    const activeLangCount = files.filter((f) => f.language === activeLang).length;
    const defaultPath = hasEntry
      ? `file${activeLangCount + 1}.${languageExtension(activeLang)}`
      : entryName;
    const newFile: WorkspaceFile & { language: Language } = {
      language: activeLang,
      path: defaultPath,
      content: "",
      description: "",
      visibility: "editable",
      editableRegions: null,
      orderIndex: files.length
    };
    files = [...files, newFile];
    selectedIndex = files.length - 1;
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
      files
    };
  }

  let initialSnapshot = JSON.stringify(buildPayload());
  $effect(() => {
    const current = JSON.stringify(buildPayload());
    ondirtychange?.(current !== initialSnapshot);
  });

  function validateEntryFiles(): string | null {
    for (const lang of allowedLanguages) {
      const entryName = entryFileNameFor(lang);
      const matches = files.filter(
        (f) => f.language === lang && f.path === entryName && f.visibility === "editable"
      );
      if (matches.length !== 1) {
        return m.workspace_mustHaveMainFile({ filename: entryName });
      }
    }
    return null;
  }

  async function handleSave() {
    const validationError = validateEntryFiles();
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
</script>

<div class="space-y-6">
  <!-- Runtime -->
  <section class="rounded-xl border border-border-subtle p-4">
    <h3 class="text-body-sm font-semibold">Runtime</h3>
    <div class="mt-3 grid gap-3 md:grid-cols-2">
      <label class="text-caption text-muted-foreground">
        <span>Time limit (ms)</span>
        <input
          class={inputClassName}
          type="number"
          min="100"
          max="30000"
          bind:value={timeLimitMs}
        />
      </label>
      <label class="text-caption text-muted-foreground">
        <span>Memory limit (MB)</span>
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
        <span class="text-caption font-semibold text-muted-foreground">Environment variables</span>
        <button
          type="button"
          class="text-caption text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-foreground"
          onclick={addEnvRow}
        >
          + Add
        </button>
      </div>
      {#if envRows.length === 0}
        <p class="mt-2 text-caption text-muted-foreground">None configured.</p>
      {:else}
        <div class="mt-2 space-y-2">
          {#each envRows as row, i (`env-${i}`)}
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
                aria-label="Remove env var"
              >
                &times;
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </section>

  <!-- Allowed languages -->
  <section class="rounded-xl border border-border-subtle p-4">
    <h3 class="text-body-sm font-semibold">Allowed languages</h3>
    <div class="mt-3 flex flex-wrap gap-2">
      {#each supportedLanguages as lang (lang)}
        <label class="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-caption">
          <input
            type="checkbox"
            class="accent-primary"
            checked={allowedLanguages.includes(lang)}
            onchange={() => toggleLanguage(lang)}
          />
          <span>{lang}</span>
        </label>
      {/each}
    </div>
  </section>

  <!-- Files per language -->
  <section class="rounded-xl border border-border-subtle p-4">
    <div class="flex items-center justify-between">
      <h3 class="text-body-sm font-semibold">Files</h3>
      <select
        class="{inputClassName} w-auto text-caption"
        value={activeLang}
        onchange={(e) => {
          activeLang = (e.target as HTMLSelectElement).value as Language;
          selectedIndex = 0;
        }}
      >
        {#each allowedLanguages as lang (lang)}
          <option value={lang}>{lang}</option>
        {/each}
      </select>
    </div>

    <div class="mt-3 grid gap-3 md:grid-cols-[200px_1fr]">
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
          class="flex h-full items-center justify-center rounded-lg border border-dashed border-border-subtle p-6 text-body-sm text-muted-foreground"
        >
          No files for {activeLang}. Click "+ Add" to create one.
        </div>
      {/if}
    </div>
  </section>

  <!-- Save -->
  <div class="flex items-center justify-end gap-3">
    <button
      type="button"
      class="inline-flex rounded-full bg-primary px-5 py-3 text-body-sm font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
      disabled={saving}
      onclick={() => void handleSave()}
    >
      {saving ? "Saving..." : "Save workspace"}
    </button>
    {#if saveMessage === "saved"}
      <span class="text-body-sm text-success">Saved</span>
    {:else if saveMessage === "error"}
      <span class="text-body-sm text-destructive">Save failed</span>
    {:else if saveMessage !== ""}
      <span class="text-body-sm text-destructive">{saveMessage}</span>
    {/if}
  </div>
</div>
