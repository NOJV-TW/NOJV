<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    /** Pre-formatted character count string (uses caller-owned locale). */
    charsLabel: string;
    isRunning: boolean;
    isSubmitting: boolean;
    hasSubmittableSource: boolean;
    availableLanguageCount: number;
    onRun: () => void;
    onSubmit: () => void;
  }

  let {
    charsLabel,
    isRunning,
    isSubmitting,
    hasSubmittableSource,
    availableLanguageCount,
    onRun,
    onSubmit
  }: Props = $props();

  let disabled = $derived(availableLanguageCount === 0 || !hasSubmittableSource);
</script>

<div
  class="flex items-center justify-between border-t border-border-subtle bg-muted/40 px-4 py-1"
>
  <span class="text-caption font-medium text-muted-foreground tabular-nums">
    {charsLabel} {m.editor_chars()}
  </span>
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
