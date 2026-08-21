<script lang="ts">
  import X from "@lucide/svelte/icons/x";
  import { m } from "$lib/paraglide/messages.js";
  import type { StagedFile } from "./AdvancedUploader.svelte";

  interface Props {
    staged: StagedFile | null;
    isSubmitting: boolean;
    onClear: () => void;
    onSubmit: () => void;
  }

  let { staged, isSubmitting, onClear, onSubmit }: Props = $props();
</script>

<div
  class="flex items-center justify-between border-t border-border-subtle bg-muted/40 px-4 py-2.5"
>
  <span class="text-caption font-medium text-muted-foreground tabular-nums">
    {#if staged}
      {m.upload_filesStaged({ count: staged.sourceFiles.length })}
    {:else}
      {m.upload_noFileSelected()}
    {/if}
  </span>
  <div class="flex items-center gap-2">
    <button
      class="inline-flex size-7 items-center justify-center rounded bg-transparent text-muted-foreground transition-[color] duration-fast ease-out-soft hover:bg-transparent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      disabled={!staged || isSubmitting}
      onclick={onClear}
      type="button"
      aria-label={m.common_clear()}
      title={m.common_clear()}
    >
      <X aria-hidden="true" class="size-4" />
    </button>
    <button
      class="rounded-full bg-success px-4 py-1.5 text-body-sm font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={!staged || isSubmitting}
      onclick={onSubmit}
      type="button"
    >
      {isSubmitting ? m.editor_submitting() : m.editor_submitButton()}
    </button>
  </div>
</div>
