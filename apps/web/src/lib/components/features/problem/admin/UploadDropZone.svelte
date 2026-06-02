<script lang="ts">
  import { UploadCloud } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";

  interface Props {
    label: string;
    hint?: string;
    accept?: string;
    disabled?: boolean;
    onupload: (file: File) => Promise<void>;
  }

  let { label, hint, accept, disabled = false, onupload }: Props = $props();

  let fileInput: HTMLInputElement | undefined = $state();
  let isDragOver = $state(false);
  let isUploading = $state(false);

  async function handleFile(file: File | null) {
    if (!file || disabled) return;
    isUploading = true;
    try {
      await onupload(file);
    } catch (err) {
      const message = err instanceof Error ? err.message : m.bundle_uploadFailed();
      toasts.add({ message, type: "error" });
    } finally {
      isUploading = false;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;
    const file = e.dataTransfer?.files?.[0] ?? null;
    void handleFile(file);
  }

  function onFileChange() {
    const file = fileInput?.files?.[0] ?? null;
    void handleFile(file);
    if (fileInput) fileInput.value = "";
  }
</script>

<div
  class="relative flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2 text-caption transition-colors duration-fast ease-out-soft
    {isDragOver
      ? 'border-primary bg-primary/5'
      : 'border-border-subtle bg-muted/30'}
    {disabled ? 'opacity-60' : ''}"
  ondrop={onDrop}
  ondragover={(e) => {
    if (disabled) return;
    e.preventDefault();
    isDragOver = true;
  }}
  ondragleave={() => {
    isDragOver = false;
  }}
  role="region"
  aria-label={label}
>
  <div class="flex min-w-0 items-center gap-2 text-muted-foreground">
    <UploadCloud class="h-4 w-4 shrink-0" aria-hidden="true" />
    <div class="min-w-0">
      <p class="truncate font-medium text-foreground">{label}</p>
      {#if hint}
        <p class="truncate text-micro text-muted-foreground">{hint}</p>
      {/if}
    </div>
  </div>
  <button
    type="button"
    class="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-caption font-medium text-foreground transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
    disabled={disabled || isUploading}
    onclick={() => fileInput?.click()}
  >
    {isUploading ? m.common_uploading() : m.bundle_chooseFile()}
  </button>
  <input
    bind:this={fileInput}
    type="file"
    {accept}
    class="sr-only"
    onchange={onFileChange}
  />
</div>
