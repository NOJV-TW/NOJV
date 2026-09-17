<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    editDescription: string;
    editWeight: number;
    saving: boolean;
    onSave: () => void;
    onCancel: () => void;
    onDescriptionChange: (v: string) => void;
    onWeightChange: (v: number) => void;
  }

  let {
    editDescription,
    editWeight,
    saving,
    onSave,
    onCancel,
    onDescriptionChange,
    onWeightChange,
  }: Props = $props();
</script>

<div
  class="mt-3 flex flex-wrap items-end gap-3 rounded-md border border-border-subtle bg-[color:var(--color-panel)] p-3"
>
  <label class="grid gap-1">
    <span class="text-caption font-medium text-muted-foreground"
      >{m.testcases_editSetWeight()}</span
    >
    <input
      class="w-20 rounded-md border border-border bg-[color:var(--color-panel)] px-3 py-2 text-body-sm tabular-nums"
      type="number"
      min="0"
      value={editWeight}
      oninput={(e) => onWeightChange(Number((e.target as HTMLInputElement).value) || 0)}
    />
  </label>
  <label class="grid basis-full gap-1">
    <span class="text-caption font-medium text-muted-foreground"
      >{m.testcases_editSetDescription()}</span
    >
    <textarea
      class="min-h-20 rounded-md border border-border bg-[color:var(--color-panel)] px-3 py-2 text-body-sm"
      value={editDescription}
      oninput={(e) => onDescriptionChange((e.target as HTMLTextAreaElement).value)}></textarea>
  </label>
  <div class="flex gap-2">
    <button
      class="rounded-full bg-primary px-4 py-2 text-caption font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 disabled:opacity-70"
      onclick={onSave}
      disabled={saving}
      type="button"
    >
      {saving ? m.admin_saving() : m.common_save()}
    </button>
    <button
      class="rounded-full border border-border px-4 py-2 text-caption font-semibold transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5"
      onclick={onCancel}
      type="button"
    >
      {m.common_cancel()}
    </button>
  </div>
</div>
