<script lang="ts">
  import { FileArchive, Upload } from "@lucide/svelte";
  import type { AdvancedConfig } from "@nojv/core";
  import { Button } from "$lib/components/primitives/ui/button";

  interface Issue {
    code: string;
    phase: string;
    file?: string;
    message: string;
    fix: string;
    logs?: string;
  }

  interface Props {
    problemId: string;
    config: AdvancedConfig | null;
    timeLimitMs: number;
    memoryLimitMb: number;
    requiredPaths: string[];
    onuploaded: () => Promise<void>;
  }

  let { problemId, config, timeLimitMs, memoryLimitMb, requiredPaths, onuploaded }: Props =
    $props();

  let uploading = $state(false);
  let issue = $state<Issue | null>(null);
  let success = $state<string | null>(null);

  const resultJsonExample = `{
  "verdict": "accepted",
  "score": 100,
  "message": "all tests passed"
}`;

  async function upload(file: File) {
    uploading = true;
    issue = null;
    success = null;
    try {
      const fd = new FormData();
      fd.set("package", file);
      const res = await fetch(`/api/problems/${problemId}/advanced-package`, {
        method: "POST",
        headers: { "X-Requested-With": "fetch" },
        body: fd,
      });
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        issue?: Issue;
        builtImages?: string[];
        maxScore?: number;
        requiredPaths?: string[];
      } | null;
      if (!res.ok || !body?.success) {
        issue =
          body?.issue ??
          ({
            code: "ADV_PACKAGE_UPLOAD_FAILED",
            phase: "parse",
            message: "Advanced package upload failed.",
            fix: "Check the ZIP format and retry.",
          } satisfies Issue);
        return;
      }
      success = `Built ${body.builtImages?.join(", ") ?? "run, grade"} images; max score ${String(body.maxScore ?? config?.maxScore ?? 100)}.`;
      await onuploaded();
    } finally {
      uploading = false;
    }
  }

  function onPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void upload(file);
    input.value = "";
  }
</script>

<section class="space-y-4">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h3 class="text-body-lg font-semibold">Advanced package</h3>
      <p class="text-body-sm text-muted-foreground">
        Upload one NOJV Advanced ZIP. NOJV builds the run/grade images, stores them internally,
        and uses the manifest as the single source of truth.
      </p>
    </div>
    <div class="flex gap-2">
      <Button variant="outline" size="sm" href="/api/problems/advanced-scaffold"
        >Template</Button
      >
      <Button variant="outline" size="sm" href="/guides/advanced-mode">Guide</Button>
    </div>
  </div>

  <div class="grid gap-3 sm:grid-cols-3">
    <div class="rounded-lg border border-border-subtle p-3">
      <div class="text-caption uppercase text-muted-foreground">Max score</div>
      <div class="text-title-sm">{config?.maxScore ?? "Not ready"}</div>
    </div>
    <div class="rounded-lg border border-border-subtle p-3">
      <div class="text-caption uppercase text-muted-foreground">Runtime</div>
      <div class="text-title-sm">{timeLimitMs} ms / {memoryLimitMb} MB</div>
    </div>
    <div class="rounded-lg border border-border-subtle p-3">
      <div class="text-caption uppercase text-muted-foreground">Required paths</div>
      <div class="text-title-sm">{requiredPaths.length}</div>
    </div>
  </div>

  <label
    class="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-subtle bg-[color:var(--color-surface)] px-4 py-8 text-center transition hover:border-border"
  >
    <FileArchive class="size-8 text-muted-foreground" />
    <span class="text-body-sm font-medium">Choose advanced.zip</span>
    <span class="text-caption text-muted-foreground"
      >Root must contain nojv-advanced.yaml, run/, and grade/.</span
    >
    <input
      class="sr-only"
      type="file"
      accept=".zip,application/zip"
      disabled={uploading}
      onchange={onPick}
    />
  </label>

  {#if uploading}
    <div class="flex items-center gap-2 text-body-sm text-muted-foreground">
      <Upload class="size-4 animate-pulse" />
      Building package images. This can take a few minutes.
    </div>
  {/if}

  {#if success}
    <div
      class="rounded-lg border border-success/30 bg-success/10 p-3 text-body-sm text-success"
    >
      {success}
    </div>
  {/if}

  {#if issue}
    <div class="space-y-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-body-sm">
      <div class="font-semibold text-danger">{issue.code}: {issue.message}</div>
      <div><span class="font-medium">Phase:</span> {issue.phase}</div>
      {#if issue.file}<div><span class="font-medium">File:</span> {issue.file}</div>{/if}
      <div><span class="font-medium">Fix:</span> {issue.fix}</div>
      {#if issue.logs}
        <pre
          class="max-h-56 overflow-auto rounded bg-black/80 p-3 text-caption text-white">{issue.logs}</pre>
      {/if}
    </div>
  {/if}

  <details class="rounded-lg border border-border-subtle p-3 text-body-sm">
    <summary class="cursor-pointer font-medium">Power user package contract</summary>
    <div class="mt-3 space-y-3 text-muted-foreground">
      <div>
        <div class="font-medium text-foreground">ZIP layout</div>
        <pre
          class="mt-2 overflow-auto rounded bg-muted p-3 text-caption text-foreground">nojv-advanced.yaml
run/Dockerfile
grade/Dockerfile
samples/accepted/submission.zip</pre>
      </div>
      <div>
        <div class="font-medium text-foreground">Manifest owns limits and scoring</div>
        <pre
          class="mt-2 overflow-auto rounded bg-muted p-3 text-caption text-foreground">version: 1
scoring:
  maxScore: 100
resources:
  timeLimitMs: 30000
  memoryLimitMb: 512
student:
  requiredPaths:
    - answer.py
network:
  mode: none</pre>
      </div>
      <div>
        <div class="font-medium text-foreground">
          Samples are required and executed on upload
        </div>
        <pre
          class="mt-2 overflow-auto rounded bg-muted p-3 text-caption text-foreground">samples:
  - name: full-credit
    submission: samples/full-credit.zip
    expect:
      verdict: accepted
      score: 100</pre>
      </div>
      <div>
        <div class="font-medium text-foreground">grade must write result.json</div>
        <pre
          class="mt-2 overflow-auto rounded bg-muted p-3 text-caption text-foreground">{resultJsonExample}</pre>
        <p class="mt-2">
          Score must be an integer from 0 to maxScore. An accepted result must award maxScore;
          partial credit should use another verdict with a lower score.
        </p>
      </div>
    </div>
  </details>
</section>
