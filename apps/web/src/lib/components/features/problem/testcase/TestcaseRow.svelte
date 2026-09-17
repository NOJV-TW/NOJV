<script lang="ts">
  import { Pencil, Trash2 } from "@lucide/svelte";
  import { MAX_INLINE_TESTCASE_EDIT_BYTES } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { formatBytes } from "$lib/utils/storage-budget-format";

  interface TestcaseData {
    id: string;
    ordinal: number;
    inputSize: number;
    outputSize: number | null;
  }

  interface Props {
    tc: TestcaseData;
    editing: boolean;
    loading: boolean;
    confirmingDelete: boolean;
    saving: boolean;
    editInput: string;
    editOutput: string;
    onStartEdit: () => void;
    onSaveEdit: () => void;
    onCancelEdit: () => void;
    onStartDelete: () => void;
    onConfirmDelete: () => void;
    onCancelDelete: () => void;
    onInputChange: (v: string) => void;
    onOutputChange: (v: string) => void;
  }

  let {
    tc,
    editing,
    loading,
    confirmingDelete,
    saving,
    editInput,
    editOutput,
    onStartEdit,
    onSaveEdit,
    onCancelEdit,
    onStartDelete,
    onConfirmDelete,
    onCancelDelete,
    onInputChange,
    onOutputChange,
  }: Props = $props();

  let tooLarge = $derived(
    Math.max(tc.inputSize, tc.outputSize ?? 0) > MAX_INLINE_TESTCASE_EDIT_BYTES,
  );
  let inlineLimitMib = MAX_INLINE_TESTCASE_EDIT_BYTES / (1024 * 1024);
</script>

<div class="rounded-md border border-border-subtle p-3">
  {#if editing}
    <div class="space-y-2">
      <label class="grid gap-1 text-caption text-muted-foreground">
        {m.testcases_input()}
        <textarea
          class="w-full rounded-md border border-border bg-[color:var(--color-panel)] px-3 py-2 font-mono text-caption"
          rows={3}
          value={editInput}
          oninput={(e) => onInputChange((e.target as HTMLTextAreaElement).value)}></textarea>
      </label>
      <label class="grid gap-1 text-caption text-muted-foreground">
        {m.testcases_output()}
        <textarea
          class="w-full rounded-md border border-border bg-[color:var(--color-panel)] px-3 py-2 font-mono text-caption"
          rows={3}
          value={editOutput}
          oninput={(e) => onOutputChange((e.target as HTMLTextAreaElement).value)}></textarea>
      </label>
      <div class="flex gap-2">
        <button
          class="rounded-full bg-primary px-4 py-1.5 text-caption font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 disabled:opacity-70"
          onclick={onSaveEdit}
          disabled={saving}
          type="button"
        >
          {saving ? m.admin_saving() : m.common_save()}
        </button>
        <button
          class="rounded-full border border-border px-4 py-1.5 text-caption font-semibold transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5"
          onclick={onCancelEdit}
          type="button"
        >
          {m.common_cancel()}
        </button>
      </div>
    </div>
  {:else if confirmingDelete}
    <div class="flex items-center gap-3">
      <span class="text-body-sm text-destructive">
        {m.testcases_confirmDeleteCase({ ordinal: tc.ordinal })}
      </span>
      <button
        class="rounded-full bg-destructive px-4 py-1.5 text-caption font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 disabled:opacity-70"
        onclick={onConfirmDelete}
        disabled={saving}
        type="button"
      >
        {saving ? m.testcases_deleting() : m.testcases_confirm()}
      </button>
      <button
        class="rounded-full border border-border px-4 py-1.5 text-caption font-semibold transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5"
        onclick={onCancelDelete}
        type="button"
      >
        {m.common_cancel()}
      </button>
    </div>
  {:else}
    <div class="flex items-start gap-3">
      <span class="shrink-0 text-caption font-medium text-muted-foreground tabular-nums">
        #{tc.ordinal}
      </span>
      <div class="min-w-0 flex-1 grid gap-1">
        <div class="text-caption text-muted-foreground">
          <span class="font-medium">{m.testcases_input()}:</span>
          <span class="ml-1 tabular-nums">{formatBytes(tc.inputSize)}</span>
        </div>
        <div class="text-caption text-muted-foreground">
          <span class="font-medium">{m.testcases_output()}:</span>
          <span class="ml-1 tabular-nums">{formatBytes(tc.outputSize ?? 0)}</span>
        </div>
      </div>
      <div class="flex shrink-0 gap-1">
        <button
          class="rounded p-1 text-muted-foreground transition-[color] duration-fast ease-out-soft hover:bg-transparent hover:text-foreground disabled:opacity-50"
          onclick={onStartEdit}
          disabled={loading || tooLarge}
          type="button"
          title={tooLarge
            ? m.testcases_tooLargeToEdit({ max: inlineLimitMib })
            : m.testcases_editTestcase()}
        >
          <Pencil aria-hidden="true" class="size-3" />
        </button>
        <button
          class="rounded p-1 text-muted-foreground transition-[color] duration-fast ease-out-soft hover:bg-transparent hover:text-destructive"
          onclick={onStartDelete}
          type="button"
          title={m.testcases_deleteTestcase()}
        >
          <Trash2 aria-hidden="true" class="size-3" />
        </button>
      </div>
    </div>
  {/if}
</div>
