<script lang="ts">
  import { inputClassName } from "$lib/utils";
  import type { ProblemImageSource } from "@nojv/core";

  interface ResourceLimits {
    totalTimeMs: number;
    memoryMb: number;
    networkEnabled: boolean;
  }

  interface Props {
    problemId: string;
    imageRef: string;
    imageSource: ProblemImageSource;
    resourceLimits: ResourceLimits;
    onsave?: (payload: {
      imageRef: string;
      imageSource: ProblemImageSource;
      resourceLimits: ResourceLimits;
    }) => void;
  }

  let {
    problemId,
    imageRef = $bindable(""),
    imageSource = $bindable<ProblemImageSource>("registry"),
    resourceLimits = $bindable<ResourceLimits>({
      totalTimeMs: 30_000,
      memoryMb: 1_024,
      networkEnabled: false,
    }),
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

  function save() {
    saving = true;
    onsave?.({ imageRef, imageSource, resourceLimits });
    setTimeout(() => {
      saving = false;
    }, 200);
  }
</script>

<section class="space-y-6">
  <header class="space-y-1">
    <h3 class="text-lg font-semibold">Judge image</h3>
    <p class="text-sm text-muted-foreground">
      Provide a Docker image that implements the advanced container contract.
    </p>
  </header>

  <!-- Source picker -->
  <div class="space-y-3">
    <span class="text-sm font-medium">Source</span>
    <div class="flex gap-3">
      <label class="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name={`image-source-${problemId}`}
          value="registry"
          checked={imageSource === "registry"}
          onchange={() => (imageSource = "registry")}
        />
        Registry
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name={`image-source-${problemId}`}
          value="tarball"
          checked={imageSource === "tarball"}
          onchange={() => (imageSource = "tarball")}
        />
        Tarball upload
      </label>
    </div>
  </div>

  {#if imageSource === "registry"}
    <label class="block text-sm">
      <span class="text-sm font-medium">Image reference</span>
      <input
        class={inputClassName}
        bind:value={imageRef}
        placeholder="ghcr.io/your-org/your-judge:tag"
        spellcheck="false"
      />
      <p class="mt-2 text-xs text-muted-foreground">
        e.g. <code>ghcr.io/your-org/your-judge:tag</code> — the worker will
        try to pull this image at judge time.
      </p>
    </label>
  {:else}
    <div>
      <div
        role="button"
        tabindex="0"
        aria-disabled={uploading}
        class="rounded-2xl border-2 border-dashed border-border p-6 text-center text-sm transition {dragOver
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
            ? "Uploading…"
            : (uploadedFileName ?? "Drop a docker tarball here, or click to browse")}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          Build with <code>docker save your-image:tag -o judge.tar</code>
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
        <p class="mt-2 text-xs text-destructive">{uploadError}</p>
      {/if}
    </div>
  {/if}

  <!-- Resource limits -->
  <div class="grid gap-4 md:grid-cols-3">
    <label class="text-sm">
      <span class="text-sm font-medium">Total time (ms)</span>
      <input
        type="number"
        class={inputClassName}
        min="1000"
        max="300000"
        bind:value={resourceLimits.totalTimeMs}
      />
    </label>
    <label class="text-sm">
      <span class="text-sm font-medium">Memory (MB)</span>
      <input
        type="number"
        class={inputClassName}
        min="16"
        max="4096"
        bind:value={resourceLimits.memoryMb}
      />
    </label>
    <label class="flex items-end gap-3 text-sm">
      <input
        type="checkbox"
        class="size-4"
        bind:checked={resourceLimits.networkEnabled}
      />
      <span>Allow network</span>
    </label>
  </div>

  <!-- Contract docs -->
  <details class="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm">
    <summary class="cursor-pointer font-medium">Container contract</summary>
    <div class="mt-3 space-y-2 text-muted-foreground">
      <p>The judge container is launched with the following workspace:</p>
      <ul class="ml-4 list-disc space-y-1">
        <li><code>/workspace/submission/</code> — student source files</li>
        <li>
          <code>/workspace/testcases/N/</code> — per-testcase data
          (<code>input.txt</code>, optional <code>expected.txt</code>, plus any
          aux files you upload)
        </li>
        <li><code>/workspace/meta.json</code> — submission metadata</li>
        <li>
          <code>/workspace/output/result.json</code> — your judge writes the
          final verdict here
        </li>
      </ul>
      <p>
        <code>result.json</code> must conform to <code>advancedResultSchema</code>:
        a top-level <code>score</code> (0–100), <code>verdict</code>, and
        optional <code>testcases</code>/<code>subtasks</code> arrays.
      </p>
      <a
        class="inline-block rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-background"
        href="/advanced-mode/starter.Dockerfile"
        download
      >
        Download starter Dockerfile
      </a>
      <a
        class="ml-2 inline-block rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-background"
        href="/advanced-mode/judge.py"
        download
      >
        Download example judge.py
      </a>
    </div>
  </details>

  <div class="flex justify-end">
    <button
      type="button"
      class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
      disabled={saving}
      onclick={save}
    >
      {saving ? "Saving…" : "Save image config"}
    </button>
  </div>
</section>
