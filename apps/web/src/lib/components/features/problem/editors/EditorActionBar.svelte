<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    isRunning: boolean;
    isSubmitting: boolean;
    hasSubmittableSource: boolean;
    availableLanguageCount: number;
    attemptsExhausted?: boolean;
    draftEnabled?: boolean;
    isDirty?: boolean;
    lastSavedAt?: number | null;
    cooldownUntil?: number | null;
    onRun: () => void;
    onSubmit: () => void;
  }

  let {
    isRunning,
    isSubmitting,
    hasSubmittableSource,
    availableLanguageCount,
    attemptsExhausted = false,
    draftEnabled = false,
    isDirty = false,
    lastSavedAt = null,
    cooldownUntil = null,
    onRun,
    onSubmit,
  }: Props = $props();

  let disabled = $derived(availableLanguageCount === 0 || !hasSubmittableSource);

  let now = $state(Date.now());
  let cooldownRemaining = $derived(
    cooldownUntil != null ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000)) : 0,
  );

  $effect(() => {
    const until = cooldownUntil;
    if (until == null || until <= Date.now()) return;
    now = Date.now();
    const id = setInterval(() => {
      now = Date.now();
      if (until <= now) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  });
</script>

<div
  data-tour="problem-actions"
  class="flex items-center justify-between border-t border-border-subtle bg-muted/40 px-4 py-1"
>
  <div class="flex items-center gap-2">
    {#if draftEnabled}
      {#if isDirty}
        <span class="flex items-center gap-1.5 text-caption font-medium text-warning">
          <span class="inline-block size-1.5 animate-pulse rounded-full bg-warning"></span>
          {m.draft_unsaved()}
        </span>
      {:else if lastSavedAt != null}
        <span class="flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
          <span class="inline-block size-1.5 rounded-full bg-success"></span>
          {m.draft_saved()}
        </span>
      {/if}
    {/if}
  </div>
  <div class="flex items-center gap-2">
    <button
      class="rounded-full border border-border px-3 py-1 text-caption font-medium text-foreground transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isRunning || disabled}
      aria-busy={isRunning}
      onclick={onRun}
      title={!hasSubmittableSource ? m.editor_emptySourceTooltip() : undefined}
      type="button"
    >
      {isRunning ? m.editor_running() : m.editor_run()}
    </button>
    <button
      class="rounded-full bg-success px-3 py-1 text-caption font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isSubmitting || disabled || attemptsExhausted || cooldownRemaining > 0}
      aria-busy={isSubmitting}
      onclick={onSubmit}
      title={attemptsExhausted
        ? m.editor_attemptsExhaustedTooltip()
        : !hasSubmittableSource
          ? m.editor_emptySourceTooltip()
          : undefined}
      type="button"
    >
      {#if cooldownRemaining > 0}
        {m.editor_submitCooldown({ seconds: cooldownRemaining })}
      {:else if isSubmitting}
        {m.editor_submitting()}
      {:else}
        {m.editor_submitButton()}
      {/if}
    </button>
  </div>
</div>
