<script lang="ts">
  import { Trash2 } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    isRunning: boolean;
    isSubmitting: boolean;
    hasSubmittableSource: boolean;
    availableLanguageCount: number;
    draftEnabled?: boolean;
    isDirty?: boolean;
    lastSavedAt?: number | null;
    onClearDraft?: (() => void) | undefined;
    onRun: () => void;
    onSubmit: () => void;
  }

  let {
    isRunning,
    isSubmitting,
    hasSubmittableSource,
    availableLanguageCount,
    draftEnabled = false,
    isDirty = false,
    lastSavedAt = null,
    onClearDraft,
    onRun,
    onSubmit
  }: Props = $props();

  let disabled = $derived(availableLanguageCount === 0 || !hasSubmittableSource);
</script>

<div
  class="flex items-center justify-between border-t border-border-subtle bg-muted/40 px-4 py-1"
>
  <div class="flex items-center gap-2">
    {#if draftEnabled}
      {#if isDirty}
        <span class="flex items-center gap-1.5 text-caption font-medium text-amber-500">
          <span class="inline-block size-1.5 animate-pulse rounded-full bg-amber-500"></span>
          {m.draft_unsaved()}
        </span>
      {:else if lastSavedAt != null}
        <span class="flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
          <span class="inline-block size-1.5 rounded-full bg-success"></span>
          {m.draft_saved()}
        </span>
      {/if}
      {#if lastSavedAt != null || isDirty}
        <button
          aria-label={m.draft_clearAction()}
          class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
          onclick={() => onClearDraft?.()}
          title={m.draft_clearAction()}
          type="button"
        >
          <Trash2 aria-hidden="true" class="h-3.5 w-3.5" />
        </button>
      {/if}
    {/if}
  </div>
  <div class="flex items-center gap-2">
    <button
      class="rounded-full border border-border px-3 py-1 text-caption font-medium text-foreground transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isRunning || disabled}
      onclick={onRun}
      title={!hasSubmittableSource ? m.editor_emptySourceTooltip() : undefined}
      type="button"
    >
      {isRunning ? m.editor_running() : m.editor_run()}
    </button>
    <button
      class="rounded-full bg-success px-3 py-1 text-caption font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isSubmitting || disabled}
      onclick={onSubmit}
      title={!hasSubmittableSource ? m.editor_emptySourceTooltip() : undefined}
      type="button"
    >
      {isSubmitting ? m.editor_submitting() : m.editor_submitButton()}
    </button>
  </div>
</div>
