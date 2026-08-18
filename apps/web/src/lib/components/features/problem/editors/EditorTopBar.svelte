<script lang="ts">
  import { Maximize2, Minimize2, RotateCcw } from "@lucide/svelte";
  import type { Language, ProblemType, SubmissionContext } from "@nojv/core";
  import type { ProblemDetail } from "$lib/types";
  import { m } from "$lib/paraglide/messages.js";
  import LanguageSelector from "./LanguageSelector.svelte";
  import { EDITOR_FONT_SIZES, submissionContextBadge } from "./editor-bindings";

  interface Props {
    language: Language;
    allowedLanguages: Language[] | undefined;
    problemType: ProblemType;
    workspaceFiles: ProblemDetail["workspaceFiles"];
    context: SubmissionContext;
    fontSize: number;
    isFullscreen: boolean;
    onLanguageChange: (next: Language) => void;
    onFontSizeChange: (next: number) => void;
    onAvailableChange: (available: Language[]) => void;
    onReset: () => void;
    onToggleFullscreen: () => void;
  }

  let {
    language,
    allowedLanguages,
    problemType,
    workspaceFiles,
    context,
    fontSize,
    isFullscreen,
    onLanguageChange,
    onFontSizeChange,
    onAvailableChange,
    onReset,
    onToggleFullscreen,
  }: Props = $props();

  let contextBadge = $derived(submissionContextBadge(context));
</script>

<div
  class="flex h-9 items-center justify-between border-b border-border-subtle bg-muted/40 px-3"
>
  <div class="flex items-center gap-3">
    <span class="text-caption font-semibold text-foreground/70">&lt;/&gt;</span>
    <LanguageSelector
      value={language}
      {allowedLanguages}
      {problemType}
      {workspaceFiles}
      onchange={onLanguageChange}
      onavailablechange={onAvailableChange}
    />
    <select
      aria-label={m.editor_fontSize()}
      class="rounded-sm border border-border-subtle bg-transparent px-1.5 py-0.5 text-micro font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      onchange={(event) =>
        onFontSizeChange(Number((event.currentTarget as HTMLSelectElement).value))}
      title={m.editor_fontSize()}
      value={fontSize}
    >
      {#each EDITOR_FONT_SIZES as size (size)}
        <option value={size}>{size}px</option>
      {/each}
    </select>
  </div>
  <div class="flex items-center gap-2">
    {#if contextBadge === "contest"}
      <span
        class="rounded-full bg-warning/15 px-2.5 py-0.5 text-caption font-medium text-warning"
      >
        {m.editor_contestMode()}
      </span>
    {:else if contextBadge === "assignment"}
      <span class="rounded-full bg-info/15 px-2.5 py-0.5 text-caption font-medium text-info">
        {m.editor_assignmentMode()}
      </span>
    {/if}
    <button
      aria-label={m.editor_reset()}
      class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
      onclick={onReset}
      title={m.editor_reset()}
      type="button"
    >
      <RotateCcw aria-hidden="true" class="h-3.5 w-3.5" />
    </button>
    <button
      aria-label={isFullscreen ? m.editor_exitFullscreen() : m.editor_fullscreen()}
      class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
      onclick={onToggleFullscreen}
      title={isFullscreen ? m.editor_exitFullscreen() : m.editor_fullscreen()}
      type="button"
    >
      {#if isFullscreen}
        <Minimize2 aria-hidden="true" class="h-3.5 w-3.5" />
      {:else}
        <Maximize2 aria-hidden="true" class="h-3.5 w-3.5" />
      {/if}
    </button>
  </div>
</div>
