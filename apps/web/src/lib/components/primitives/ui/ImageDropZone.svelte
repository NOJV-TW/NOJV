<script lang="ts">
  import { Eye, ImagePlus, Link, Pencil } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import MarkdownRenderer from "$lib/components/primitives/layout/MarkdownRenderer.svelte";
  import { readImageUploadUrl } from "$lib/utils/image-upload-response";

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
  let uploadError = $state<string | null>(null);
  let showUrlImport = $state(false);
  let remoteUrl = $state("");

  const uploadUrl = $derived(
    problemId ? `/api/problems/${problemId}/images` : `/api/uploads/image`,
  );

  async function uploadImage(form: FormData, alt: string) {
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { "X-Requested-With": "fetch" },
      body: form,
    });
    const url = await readImageUploadUrl(res, m.imageUpload_failed());
    insertAtCursor(`![${alt}](${url})`);
  }

  async function handleFiles(files: FileList | null) {
    if (!files || isUploading) return;
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;

    isUploading = true;
    uploadError = null;
    try {
      for (const file of images) {
        const form = new FormData();
        form.append("image", file);

        await uploadImage(form, file.name);
      }
    } catch (error) {
      uploadError = error instanceof Error ? error.message : m.imageUpload_failed();
    } finally {
      isUploading = false;
    }
  }

  async function importRemoteImage() {
    if (isUploading || !remoteUrl.trim()) return;
    isUploading = true;
    uploadError = null;
    try {
      const form = new FormData();
      form.append("url", remoteUrl.trim());
      await uploadImage(form, "");
      remoteUrl = "";
      showUrlImport = false;
    } catch (error) {
      uploadError = error instanceof Error ? error.message : m.imageUpload_failed();
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
    {...restProps}></textarea>

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
    disabled={isUploading}
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
      onclick={() => (showUrlImport = !showUrlImport)}
      disabled={isUploading}
      title={m.imageUpload_fromUrl()}
      aria-label={m.imageUpload_fromUrl()}
      aria-expanded={showUrlImport}
      class="absolute bottom-2.5 right-11 inline-flex items-center justify-center rounded-full p-1.5 text-muted-foreground opacity-40 transition-[opacity,color,background-color] duration-fast ease-out-soft hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-focus-within/imgzone:opacity-100 group-hover/imgzone:opacity-100"
    >
      <Link class="h-4 w-4" aria-hidden="true" />
    </button>
    <button
      type="button"
      onclick={() => fileInput.click()}
      disabled={isUploading}
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

  {#if uploadError}
    <p class="mt-2 text-body-sm text-destructive" role="alert">{uploadError}</p>
  {/if}

  {#if isDragOver}
    <div
      class="absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/5 pointer-events-none"
    >
      <span class="text-sm text-primary">{m.common_dropToUpload()}</span>
    </div>
  {/if}
</div>

{#if showUrlImport && !isPreviewing}
  <div class="mt-2 flex flex-wrap items-center gap-2">
    <input
      type="url"
      bind:value={remoteUrl}
      aria-label={m.imageUpload_fromUrl()}
      placeholder={m.imageUpload_urlPlaceholder()}
      disabled={isUploading}
      onkeydown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          importRemoteImage();
        }
      }}
      class="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-body-sm"
    />
    <button
      type="button"
      onclick={importRemoteImage}
      disabled={isUploading || !remoteUrl.trim()}
      class="rounded-md bg-primary px-3 py-1.5 text-body-sm text-primary-foreground disabled:opacity-50"
    >
      {m.imageUpload_import()}
    </button>
    <button
      type="button"
      onclick={() => (showUrlImport = false)}
      disabled={isUploading}
      class="rounded-md px-3 py-1.5 text-body-sm text-muted-foreground"
    >
      {m.common_cancel()}
    </button>
  </div>
{/if}
