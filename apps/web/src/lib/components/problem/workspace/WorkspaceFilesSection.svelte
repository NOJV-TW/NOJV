<script lang="ts">
  import { type Language } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import WorkspaceFileList from "./WorkspaceFileList.svelte";
  import WorkspaceFileEditor, { type WorkspaceFile } from "./WorkspaceFileEditor.svelte";
  import type { WorkspaceMode } from "./WorkspaceModeSection.svelte";

  interface Props {
    mode: WorkspaceMode;
    allowedLanguages: Language[];
    activeLang: Language;
    files: (WorkspaceFile & { language: Language })[];
    selectedIndex: number;
    missingEntryLanguages: Language[];
    activeEntryFileName: string;
    activeLangHasEntry: boolean;
    activeLangIsEmpty: boolean;
    filesTitle: string;
    filesHint: string;
    filesForActiveLang: { file: WorkspaceFile & { language: Language }; index: number }[];
    activeSelected: number;
    hasEntryFileForLanguage: (lang: Language) => boolean;
    onChangeActiveLang: (lang: Language) => void;
    onAddFile: () => void;
    onUpdateFile: (globalIndex: number, updated: WorkspaceFile) => void;
    onDeleteFile: (globalIndex: number) => void;
  }

  let {
    mode,
    allowedLanguages,
    activeLang,
    files,
    selectedIndex = $bindable(),
    missingEntryLanguages,
    activeEntryFileName,
    activeLangHasEntry,
    activeLangIsEmpty,
    filesTitle,
    filesHint,
    filesForActiveLang,
    activeSelected,
    hasEntryFileForLanguage,
    onChangeActiveLang,
    onAddFile,
    onUpdateFile,
    onDeleteFile
  }: Props = $props();
</script>

<section class="rounded-lg border border-border-subtle p-2">
  <div>
    <h3 class="text-body-sm font-semibold">{filesTitle}</h3>
    <p class="mt-0.5 text-caption leading-relaxed text-muted-foreground">{filesHint}</p>
  </div>

  {#if mode === "multi_file" && missingEntryLanguages.length > 0}
    <div
      class="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-warning"
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
      class="mt-4 rounded-md border border-dashed border-border-subtle p-6 text-center text-body-sm text-muted-foreground"
    >
      {m.admin_workspaceNoLanguagesSelected()}
    </div>
  {:else}
    <div class="mt-4 -mx-1 flex flex-wrap items-center gap-1 border-b border-border-subtle pb-2">
      {#each allowedLanguages as lang (lang)}
        {@const isActive = lang === activeLang}
        {@const needsTemplate = mode === "multi_file" && !hasEntryFileForLanguage(lang)}
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-medium transition-[background-color,color] duration-fast ease-out-soft {isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
          onclick={() => onChangeActiveLang(lang)}
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

    <div class="mt-3 grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <WorkspaceFileList
        files={filesForActiveLang.map((e) => e.file)}
        selectedIndex={filesForActiveLang.findIndex((e) => e.index === activeSelected)}
        onselect={(localIdx) => {
          const entry = filesForActiveLang[localIdx];
          if (entry) selectedIndex = localIdx;
        }}
        onadd={onAddFile}
      />
      {#if activeSelected >= 0 && files[activeSelected]}
        {@const current = files[activeSelected]}
        <WorkspaceFileEditor
          file={current}
          language={activeLang}
          onchange={(updated) => onUpdateFile(activeSelected, updated)}
          ondelete={() => onDeleteFile(activeSelected)}
        />
      {:else}
        <div
          class="flex min-h-[240px] flex-col items-center justify-center gap-4 rounded-md border border-dashed border-border-subtle p-8 text-center"
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
              onclick={onAddFile}
            >
              {m.admin_workspaceCreateMainFile({ filename: activeEntryFileName })}
            </button>
          {:else}
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-caption font-medium text-muted-foreground transition-[color,border-color] duration-fast ease-out-soft hover:border-primary hover:text-primary"
              onclick={onAddFile}
            >
              {m.admin_workspaceAddOtherFile()}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</section>
