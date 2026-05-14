<script lang="ts">
  import { Eye, ImagePlus, Pencil } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import MarkdownRenderer from "$lib/components/layout/MarkdownRenderer.svelte";

  let {
    problemId,
    name,
    value = $bindable(),
    class: className = "",
    ...restProps
  }: {
    problemId?: string;
    name: string;
    value: string;
    class?: string;
    [key: string]: unknown;
  } = $props();

  let textarea: HTMLTextAreaElement;
  let fileInput: HTMLInputElement;
  let isUploading = $state(false);
  let isDragOver = $state(false);
  let isPreviewing = $state(false);

  const uploadUrl = $derived(
    problemId ? `/api/problems/${problemId}/images` : `/api/uploads/image`,
  );

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;

    isUploading = true;
    try {
      for (const file of images) {
        const form = new FormData();
        form.append("image", file);

        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "X-Requested-With": "fetch" },
          body: form,
        });

        if (res.ok) {
          const { url } = await res.json();
          insertAtCursor(`![${file.name}](${url})`);
        }
      }
    } finally {
      isUploading = false;
    }
  }

  function insertAtCursor(text: string) {
    const start = textarea.selectionStart;
    const before = value.slice(0, start);
    const after = value.slice(textarea.selectionEnd);
    value = before + text + "\n" + after;
    queueMicrotask(() => {
      const pos = before.length + text.length + 1;
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
    });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;
    handleFiles(e.dataTransfer?.files ?? null);
  }

  function onPaste(e: ClipboardEvent) {
    const files = e.clipboardData?.files;
    if (files?.length) {
      e.preventDefault();
      handleFiles(files);
    }
  }

  function onFileChange() {
    handleFiles(fileInput.files);
    fileInput.value = "";
  }
</script>

<div class="group/imgzone relative">
  <textarea
    bind:this={textarea}
    {name}
    bind:value
    ondrop={onDrop}
    ondragover={(e) => {
      e.preventDefault();
      isDragOver = true;
    }}
    ondragleave={() => {
      isDragOver = false;
    }}
    onpaste={onPaste}
    class="{className} {isDragOver ? 'ring-2 ring-primary' : ''}"
    hidden={isPreviewing}
    {...restProps}
  ></textarea>

  {#if isPreviewing}
    <div class="{className} overflow-auto" role="region" aria-label={m.imageUpload_preview()}>
      {#if value.trim()}
        <MarkdownRenderer content={value} />
      {:else}
        <p class="text-sm text-muted-foreground italic">{m.imageUpload_preview()}…</p>
      {/if}
    </div>
  {/if}

  <input
    bind:this={fileInput}
    type="file"
    accept="image/png,image/jpeg,image/gif,image/webp"
    multiple
    class="sr-only"
    onchange={onFileChange}
  />

  <button
    type="button"
    onclick={() => (isPreviewing = !isPreviewing)}
    title={isPreviewing ? m.imageUpload_write() : m.imageUpload_preview()}
    aria-label={isPreviewing ? m.imageUpload_write() : m.imageUpload_preview()}
    aria-pressed={isPreviewing}
    class="absolute top-2.5 right-3 inline-flex items-center justify-center rounded-full p-1.5 text-muted-foreground opacity-40 transition-[opacity,color,background-color] duration-fast ease-out-soft hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-focus-within/imgzone:opacity-100 group-hover/imgzone:opacity-100"
  >
    {#if isPreviewing}
      <Pencil class="h-4 w-4" aria-hidden="true" />
    {:else}
      <Eye class="h-4 w-4" aria-hidden="true" />
    {/if}
  </button>

  {#if !isPreviewing}
    <button
      type="button"
      onclick={() => fileInput.click()}
      title={m.imageUpload_button()}
      aria-label={m.imageUpload_button()}
      class="absolute bottom-2.5 right-3 inline-flex items-center justify-center rounded-full p-1.5 text-muted-foreground opacity-40 transition-[opacity,color,background-color] duration-fast ease-out-soft hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-focus-within/imgzone:opacity-100 group-hover/imgzone:opacity-100"
    >
      <ImagePlus class="h-4 w-4" aria-hidden="true" />
    </button>
  {/if}

  {#if isUploading}
    <div
      class="absolute inset-0 flex items-center justify-center rounded-md bg-background/60 pointer-events-none"
    >
      <span class="text-sm text-muted-foreground">{m.common_uploading()}</span>
    </div>
  {/if}

  {#if isDragOver}
    <div
      class="absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/5 pointer-events-none"
    >
      <span class="text-sm text-primary">{m.common_dropToUpload()}</span>
    </div>
  {/if}
</div>
