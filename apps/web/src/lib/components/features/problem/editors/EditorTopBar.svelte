<script lang="ts">
  import { Maximize2, Minimize2, Minus, Plus, RotateCcw } from "@lucide/svelte";
  import type { Language, ProblemType, SubmissionContext } from "@nojv/core";
  import type { ProblemDetail } from "$lib/types";
  import { m } from "$lib/paraglide/messages.js";
  import LanguageSelector from "./LanguageSelector.svelte";
  import {
    MAX_EDITOR_FONT_SIZE,
    MIN_EDITOR_FONT_SIZE,
    submissionContextBadge,
  } from "./editor-bindings";

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
    <div class="flex items-center gap-0.5" aria-label={m.editor_fontSize()}>
      <button
        aria-label={m.editor_decreaseFontSize()}
        class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        disabled={fontSize <= MIN_EDITOR_FONT_SIZE}
        onclick={() => onFontSizeChange(fontSize - 1)}
        title={m.editor_decreaseFontSize()}
        type="button"
      >
        <Minus aria-hidden="true" class="h-3.5 w-3.5" />
      </button>
      <span
        class="min-w-9 text-center font-mono text-micro text-muted-foreground"
        aria-live="polite"
      >
        {fontSize}px
      </span>
      <button
        aria-label={m.editor_increaseFontSize()}
        class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        disabled={fontSize >= MAX_EDITOR_FONT_SIZE}
        onclick={() => onFontSizeChange(fontSize + 1)}
        title={m.editor_increaseFontSize()}
        type="button"
      >
        <Plus aria-hidden="true" class="h-3.5 w-3.5" />
      </button>
    </div>
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
