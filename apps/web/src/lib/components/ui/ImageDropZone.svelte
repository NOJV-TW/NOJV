<script lang="ts">
  let {
    problemId,
    name,
    value = $bindable(),
    class: className = "",
    ...restProps
  }: {
    problemId: string;
    name: string;
    value: string;
    class?: string;
    [key: string]: unknown;
  } = $props();

  let textarea: HTMLTextAreaElement;
  let uploading = $state(false);
  let dragOver = $state(false);

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;

    uploading = true;
    try {
      for (const file of images) {
        const form = new FormData();
        form.append("image", file);

        const res = await fetch(`/api/problems/${problemId}/images`, {
          method: "POST",
          body: form,
        });

        if (res.ok) {
          const { url } = await res.json();
          insertAtCursor(`![${file.name}](${url})`);
        }
      }
    } finally {
      uploading = false;
    }
  }

  function insertAtCursor(text: string) {
    const start = textarea.selectionStart;
    const before = value.slice(0, start);
    const after = value.slice(textarea.selectionEnd);
    value = before + text + "\n" + after;
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    handleFiles(e.dataTransfer?.files ?? null);
  }

  function onPaste(e: ClipboardEvent) {
    const files = e.clipboardData?.files;
    if (files?.length) {
      e.preventDefault();
      handleFiles(files);
    }
  }
</script>

<div class="relative">
  <textarea
    bind:this={textarea}
    {name}
    bind:value
    ondrop={onDrop}
    ondragover={(e) => { e.preventDefault(); dragOver = true; }}
    ondragleave={() => { dragOver = false; }}
    onpaste={onPaste}
    class="{className} {dragOver ? 'ring-2 ring-primary' : ''}"
    {...restProps}
  ></textarea>

  {#if uploading}
    <div
      class="absolute inset-0 flex items-center justify-center rounded-md bg-background/60 pointer-events-none"
    >
      <span class="text-sm text-muted-foreground">上傳中...</span>
    </div>
  {/if}

  {#if dragOver}
    <div
      class="absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/5 pointer-events-none"
    >
      <span class="text-sm text-primary">放開以上傳圖片</span>
    </div>
  {/if}
</div>
