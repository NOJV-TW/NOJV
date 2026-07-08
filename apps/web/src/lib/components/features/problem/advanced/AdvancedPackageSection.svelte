<script lang="ts">
  import { Download, FileArchive, RotateCcw, Upload } from "@lucide/svelte";
  import JSZip from "jszip";
  import type { AdvancedConfig } from "@nojv/core";
  import { Button } from "$lib/components/primitives/ui/button";
  import { m } from "$lib/paraglide/messages.js";
  import { monoTextareaClassName } from "$lib/utils/css";

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
    onuploaded: () => Promise<void>;
    uploadReady?: boolean;
  }

  let { problemId, config, onuploaded, uploadReady = $bindable(false) }: Props = $props();

  export function save() {
    void uploadSelectedZip();
  }

  let uploading = $state(false);
  let readingZip = $state(false);
  let issue = $state<Issue | null>(null);
  let localError = $state<string | null>(null);
  let success = $state<string | null>(null);
  let selectedZip = $state<File | null>(null);
  let originalManifestYaml = $state("");
  let manifestYaml = $state("");

  async function uploadPackage(blob: Blob, filename: string) {
    uploading = true;
    issue = null;
    localError = null;
    success = null;
    try {
      const fd = new FormData();
      fd.set("package", blob, filename);
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
            message: m.advancedPackage_uploadFailed(),
            fix: m.advancedPackage_uploadFailedFix(),
          } satisfies Issue);
        return;
      }
      success = m.advancedPackage_success({
        images: body.builtImages?.join(", ") ?? "run, grade",
        score: String(body.maxScore ?? config?.maxScore ?? 100),
      });
      await onuploaded();
    } finally {
      uploading = false;
    }
  }

  async function buildUploadBlob() {
    if (!selectedZip) throw new Error(m.advancedPackage_selectZipFirst());
    const normalizedYaml = manifestYaml.endsWith("\n") ? manifestYaml : `${manifestYaml}\n`;
    if (normalizedYaml === originalManifestYaml) return selectedZip;

    const zip = await JSZip.loadAsync(await selectedZip.arrayBuffer());
    zip.file("metadata.yaml", normalizedYaml);
    return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  }

  async function uploadSelectedZip() {
    if (!selectedZip) return;
    try {
      const blob = await buildUploadBlob();
      await uploadPackage(blob, selectedZip.name);
    } catch (err) {
      localError = err instanceof Error ? err.message : m.advancedPackage_prepareUploadFailed();
    }
  }

  async function readMetadata(file: File) {
    readingZip = true;
    issue = null;
    localError = null;
    success = null;
    selectedZip = null;
    originalManifestYaml = "";
    manifestYaml = "";
    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const metadata = zip.file("metadata.yaml");
      if (!metadata) {
        localError = m.advancedPackage_metadataMissing();
        return;
      }
      const yaml = await metadata.async("string");
      selectedZip = file;
      originalManifestYaml = yaml.endsWith("\n") ? yaml : `${yaml}\n`;
      manifestYaml = originalManifestYaml;
    } catch {
      localError = m.advancedPackage_zipReadFailed();
    } finally {
      readingZip = false;
    }
  }

  function onPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void readMetadata(file);
    input.value = "";
  }

  function downloadManifest() {
    const yaml = manifestYaml.endsWith("\n") ? manifestYaml : `${manifestYaml}\n`;
    const url = URL.createObjectURL(new Blob([yaml], { type: "text/yaml;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "metadata.yaml";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function resetManifest() {
    manifestYaml = originalManifestYaml;
  }

  $effect(() => {
    uploadReady = selectedZip !== null && !uploading && !readingZip;
  });
</script>

<section class="space-y-4">
  <div>
    <h3 class="text-body-lg font-semibold">{m.advancedPackage_title()}</h3>
    <p class="text-body-sm text-muted-foreground">
      {m.advancedPackage_intro()}
    </p>
  </div>

  <label
    class="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-subtle bg-[color:var(--color-surface)] px-4 py-8 text-center transition hover:border-border"
  >
    <FileArchive class="size-8 text-muted-foreground" />
    <span class="text-body-sm font-medium">{m.advancedPackage_chooseZip()}</span>
    <span class="text-caption text-muted-foreground">{m.advancedPackage_zipHint()}</span>
    <input
      class="sr-only"
      type="file"
      accept=".zip,application/zip"
      disabled={uploading || readingZip}
      onchange={onPick}
    />
  </label>

  {#if readingZip}
    <div class="flex items-center gap-2 text-body-sm text-muted-foreground">
      <Upload class="size-4 animate-pulse" />
      {m.advancedPackage_readingYaml()}
    </div>
  {/if}

  {#if selectedZip}
    <section class="space-y-3">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 class="text-body-sm font-semibold">{m.advancedPackage_yamlTitle()}</h4>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.advancedPackage_selectedZip({ filename: selectedZip.name })}
          </p>
          <p class="mt-1 text-caption text-muted-foreground">
            {m.advancedPackage_yamlHint()}
          </p>
        </div>
        <div class="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" size="sm" onclick={resetManifest} disabled={uploading}>
            <RotateCcw class="size-4" aria-hidden="true" />
            {m.advancedPackage_resetYaml()}
          </Button>
          <Button variant="outline" size="sm" onclick={downloadManifest} disabled={uploading}>
            <Download class="size-4" aria-hidden="true" />
            {m.advancedPackage_downloadYaml()}
          </Button>
        </div>
      </div>
      <textarea
        class={`${monoTextareaClassName} min-h-[34rem] text-caption leading-relaxed`}
        spellcheck="false"
        bind:value={manifestYaml}
        aria-label={m.advancedPackage_yamlTitle()}
        disabled={uploading}></textarea>
    </section>
  {/if}

  {#if uploading}
    <div class="flex items-center gap-2 text-body-sm text-muted-foreground">
      <Upload class="size-4 animate-pulse" />
      {m.advancedPackage_building()}
    </div>
  {/if}

  {#if localError}
    <div class="rounded-lg border border-danger/30 bg-danger/10 p-3 text-body-sm text-danger">
      {localError}
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
</section>
