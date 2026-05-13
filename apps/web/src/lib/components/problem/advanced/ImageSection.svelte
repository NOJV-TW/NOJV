<script lang="ts">
  import { inputClassName } from "$lib/utils/css";
  import { m } from "$lib/paraglide/messages.js";
  import type { ProblemImageSource } from "@nojv/core";

  interface Props {
    problemId: string;
    imageRef: string;
    imageSource: ProblemImageSource;
    timeLimitMs: number;
    memoryLimitMb: number;
    onsave?: (payload: {
      imageRef: string;
      imageSource: ProblemImageSource;
      timeLimitMs: number;
      memoryLimitMb: number;
    }) => void | Promise<void>;
  }

  let {
    problemId,
    imageRef = $bindable(""),
    imageSource = $bindable<ProblemImageSource>("registry"),
    timeLimitMs = $bindable(30_000),
    memoryLimitMb = $bindable(1_024),
    onsave,
  }: Props = $props();

  let saving = $state(false);
  let dragOver = $state(false);
  let uploadedFileName = $state<string | null>(null);
  let uploading = $state(false);
  let uploadError = $state<string | null>(null);

  async function handleTarball(file: File) {
    uploading = true;
    uploadError = null;
    try {
      const body = new FormData();
      body.set("tarball", file);
      const res = await fetch(`/api/problems/${problemId}/advanced-image`, {
        method: "POST",
        headers: { "X-Requested-With": "fetch" },
        body,
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "Upload failed");
        throw new Error(msg || `Upload failed (${String(res.status)})`);
      }
      const payload = (await res.json()) as { key: string };
      uploadedFileName = file.name;
      imageSource = "tarball";
      imageRef = payload.key;
    } catch (err) {
      uploadError = err instanceof Error ? err.message : "Upload failed";
    } finally {
      uploading = false;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleTarball(file);
  }

  function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void handleTarball(file);
  }

  async function save() {
    saving = true;
    try {
      await onsave?.({
        imageRef,
        imageSource,
        timeLimitMs,
        memoryLimitMb,
      });
    } finally {
      saving = false;
    }
  }
</script>

<section class="space-y-6">
  <header class="space-y-1">
    <h3 class="text-body-lg font-semibold">{m.admin_judgeImage()}</h3>
    <p class="text-body-sm text-muted-foreground">
      {m.admin_judgeImageHint()}
    </p>
  </header>

  <div class="space-y-3">
    <span class="text-body-sm font-medium">{m.admin_imageSource()}</span>
    <div class="flex gap-3">
      <label class="flex items-center gap-2 text-body-sm">
        <input
          type="radio"
          name={`image-source-${problemId}`}
          value="registry"
          checked={imageSource === "registry"}
          onchange={() => (imageSource = "registry")}
        />
        {m.admin_imageSourceRegistry()}
      </label>
      <label class="flex items-center gap-2 text-body-sm">
        <input
          type="radio"
          name={`image-source-${problemId}`}
          value="tarball"
          checked={imageSource === "tarball"}
          onchange={() => (imageSource = "tarball")}
        />
        {m.admin_imageSourceTarball()}
      </label>
    </div>
  </div>

  {#if imageSource === "registry"}
    <label class="block text-body-sm">
      <span class="text-body-sm font-medium">{m.admin_imageRef()}</span>
      <input
        class={inputClassName}
        bind:value={imageRef}
        placeholder={m.admin_imageRefPlaceholder()}
        spellcheck="false"
      />
      <p class="mt-2 text-caption text-muted-foreground">
        {@html m.admin_imageRefHint({ example: '<code>ghcr.io/your-org/your-judge:tag</code>' })}
      </p>
    </label>
  {:else}
    <div>
      <div
        role="button"
        tabindex="0"
        aria-disabled={uploading}
        class="rounded-lg border-2 border-dashed border-border p-4 text-center text-body-sm transition-[border-color,background-color] duration-fast ease-out-soft {dragOver
          ? 'border-primary bg-primary/5'
          : ''} {uploading ? 'cursor-wait opacity-60' : 'cursor-pointer'}"
        ondrop={onDrop}
        ondragover={(e) => {
          if (uploading) return;
          e.preventDefault();
          dragOver = true;
        }}
        ondragleave={() => (dragOver = false)}
        onclick={() => {
          if (uploading) return;
          document.getElementById(`tarball-${problemId}`)?.click();
        }}
        onkeydown={(e) => {
          if (uploading) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            document.getElementById(`tarball-${problemId}`)?.click();
          }
        }}
      >
        <p class="font-medium">
          {uploading
            ? m.admin_tarballUploading()
            : (uploadedFileName ?? m.admin_tarballDropHint())}
        </p>
        <p class="mt-1 text-caption text-muted-foreground">
          {@html m.admin_tarballBuildHint({ command: '<code>docker save your-image:tag -o judge.tar</code>' })}
        </p>
        <input
          id={`tarball-${problemId}`}
          type="file"
          accept=".tar,.tar.gz"
          class="hidden"
          disabled={uploading}
          onchange={onPick}
        />
      </div>
      {#if uploadError}
        <p class="mt-2 text-caption text-destructive">{uploadError}</p>
      {/if}
    </div>
  {/if}

  <div class="grid gap-4 md:grid-cols-2">
    <label class="text-body-sm">
      <span class="text-body-sm font-medium">{m.admin_totalTimeLimitMs()}</span>
      <input
        type="number"
        class={inputClassName}
        min="1000"
        max="300000"
        bind:value={timeLimitMs}
      />
      <p class="mt-1 text-caption text-muted-foreground">
        {m.admin_totalTimeLimitHint()}
      </p>
    </label>
    <label class="text-body-sm">
      <span class="text-body-sm font-medium">{m.admin_memoryLimitMb()}</span>
      <input
        type="number"
        class={inputClassName}
        min="16"
        max="4096"
        bind:value={memoryLimitMb}
      />
    </label>
  </div>

  <div class="flex justify-end">
    <button
      type="button"
      class="rounded-full bg-primary px-5 py-2 text-body-sm font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:bg-primary/90 disabled:opacity-50"
      disabled={saving}
      onclick={save}
    >
      {saving ? m.admin_savingImage() : m.admin_saveImageConfig()}
    </button>
  </div>
</section>
