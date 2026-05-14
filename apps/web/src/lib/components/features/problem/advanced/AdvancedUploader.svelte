<script lang="ts" module>
  import { validateRequiredPaths } from "@nojv/core";
  import { m as messages } from "$lib/paraglide/messages.js";

  const MAX_FILES = 200;
  const MAX_TOTAL_BYTES = 4 * 1024 * 1024; // 4 MB aggregate
  // Plain source extensions that are wrapped as a single-file submission.
  const PLAIN_EXTENSIONS = [
    ".c",
    ".cpp",
    ".cc",
    ".cxx",
    ".h",
    ".hpp",
    ".py",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".go",
    ".rs",
    ".java",
    ".txt",
    ".md"
  ];

  export const ADVANCED_UPLOAD_ACCEPT =
    ".zip,.c,.cpp,.cc,.cxx,.h,.hpp,.py,.js,.mjs,.cjs,.ts,.go,.rs,.java,.txt,.md";

  export type StagedFile =
    | { kind: "zip"; file: File; sourceFiles: { path: string; content: string }[] }
    | { kind: "single"; file: File; sourceFiles: { path: string; content: string }[] };

  function isPlainSourceFile(name: string): boolean {
    const lower = name.toLowerCase();
    return PLAIN_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  function isZipFile(name: string): boolean {
    return name.toLowerCase().endsWith(".zip");
  }

  /**
   * Read a user-picked file and return either a staged payload or an error
   * message. Performs ZIP extraction, MOSS-style mac-noise stripping, and
   * `validateRequiredPaths` enforcement.
   */
  export async function stageUploadedFile(
    file: File,
    requiredPaths: string[]
  ): Promise<{ ok: true; staged: StagedFile } | { ok: false; error: string }> {
    try {
      if (isZipFile(file.name)) {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(file);
        const entries: { path: string; content: string }[] = [];
        const promises: Promise<void>[] = [];
        zip.forEach((relativePath, zipEntry) => {
          if (zipEntry.dir) return;
          if (relativePath.startsWith("__MACOSX/") || relativePath.includes("/__MACOSX/")) return;
          const baseName = relativePath.split("/").pop() ?? "";
          if (baseName === ".DS_Store") return;
          promises.push(
            zipEntry.async("string").then((content) => {
              entries.push({ path: relativePath, content });
            })
          );
        });
        await Promise.all(promises);

        if (entries.length === 0) {
          return { ok: false, error: "ZIP contains no readable files." };
        }
        if (entries.length > MAX_FILES) {
          return {
            ok: false,
            error: `ZIP contains ${String(entries.length)} files (max ${String(MAX_FILES)}).`
          };
        }
        const totalBytes = entries.reduce((sum, e) => sum + e.content.length, 0);
        if (totalBytes > MAX_TOTAL_BYTES) {
          return {
            ok: false,
            error: `ZIP content exceeds ${String(MAX_TOTAL_BYTES / (1024 * 1024))} MB.`
          };
        }
        if (entries.every((e) => e.content.trim().length === 0)) {
          return { ok: false, error: messages.advancedMode_emptyZip() };
        }
        const requiredCheck = validateRequiredPaths(
          entries.map((e) => e.path),
          requiredPaths
        );
        if (!requiredCheck.ok) {
          const missingList = requiredCheck.errors.map((e) => e.path).join(", ");
          return {
            ok: false,
            error: messages.advancedRequiredPaths_missingList({ paths: missingList })
          };
        }
        entries.sort((a, b) => a.path.localeCompare(b.path));
        return { ok: true, staged: { kind: "zip", file, sourceFiles: entries } };
      }

      if (isPlainSourceFile(file.name)) {
        const content = await file.text();
        if (content.length > MAX_TOTAL_BYTES) {
          return {
            ok: false,
            error: `File exceeds ${String(MAX_TOTAL_BYTES / (1024 * 1024))} MB.`
          };
        }
        if (content.trim().length === 0) {
          return { ok: false, error: messages.advancedMode_emptyFile() };
        }
        const requiredCheck = validateRequiredPaths([file.name], requiredPaths);
        if (!requiredCheck.ok) {
          const missingList = requiredCheck.errors.map((e) => e.path).join(", ");
          return {
            ok: false,
            error: messages.advancedRequiredPaths_missingList({ paths: missingList })
          };
        }
        return {
          ok: true,
          staged: {
            kind: "single",
            file,
            sourceFiles: [{ path: file.name, content }]
          }
        };
      }

      return {
        ok: false,
        error: "Unsupported file type. Upload a .zip archive or a single source file."
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to read file."
      };
    }
  }
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    /** Stable id used for the hidden `<input type="file">` so multiple uploaders coexist. */
    inputId: string;
    /** Currently-staged payload; bindable so the parent can read it for submit. */
    staged: StagedFile | null;
    requiredPaths: string[];
    /** TA-configured paths the student's ZIP must contain. Empty array = no constraint. */
    onStagingError: (msg: string | null) => void;
  }

  let {
    inputId,
    staged = $bindable(),
    requiredPaths,
    onStagingError
  }: Props = $props();

  let staging = $state(false);
  let dragOver = $state(false);

  async function stageFile(file: File) {
    staging = true;
    onStagingError(null);
    staged = null;
    try {
      const result = await stageUploadedFile(file, requiredPaths);
      if (result.ok) {
        staged = result.staged;
      } else {
        onStagingError(result.error);
      }
    } finally {
      staging = false;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) void stageFile(file);
  }

  function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void stageFile(file);
    // Reset so selecting the same file again retriggers the change event.
    input.value = "";
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  role="button"
  tabindex="0"
  class="mt-5 cursor-pointer rounded-lg border-2 border-dashed border-border p-6 text-center transition-[border-color,background-color] duration-fast ease-out-soft {dragOver
    ? 'border-primary bg-primary/5'
    : 'hover:border-primary/40 hover:bg-muted/30'}"
  ondrop={onDrop}
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={() => (dragOver = false)}
  onclick={() => document.getElementById(inputId)?.click()}
  onkeydown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      document.getElementById(inputId)?.click();
    }
  }}
>
  {#if staging}
    <p class="text-body-sm font-medium text-muted-foreground">{m.common_readingFile()}</p>
  {:else if staged}
    <p class="font-mono text-body-sm font-medium text-foreground">{staged.file.name}</p>
    <p class="mt-1 text-caption text-muted-foreground tabular-nums">
      {staged.kind === "zip"
        ? m.upload_extractedFiles({ count: staged.sourceFiles.length })
        : m.upload_singleFile()}
    </p>
  {:else}
    <p class="text-body-sm font-medium text-foreground">
      {m.upload_dragDropHint()}
    </p>
    <p class="mt-1 text-caption text-muted-foreground">
      {m.upload_acceptedFileTypes()}
    </p>
  {/if}
  <input
    id={inputId}
    type="file"
    accept={ADVANCED_UPLOAD_ACCEPT}
    class="hidden"
    onchange={onPick}
  />
</div>
