<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import {
    apiErrorSchema,
    submissionDispatchResponseSchema,
    submissionOperationSchema,
    submissionResultSchema,
    validateRequiredPaths,
    type Language,
    type SubmissionResult
  } from "@nojv/core";
  import type {
    ProblemDetail,
    ProblemSubmissionEntry,
    ProblemTestcaseSetSummary
  } from "$lib/types";
  import ProblemLeftPanel from "../ProblemLeftPanel.svelte";

  interface Props {
    // `allowedLanguages` is irrelevant for advanced mode (TA image owns
    // execution) but accepted for prop-shape parity with ProblemWorkspace.
    allowedLanguages?: Language[] | undefined;
    assessment?: {
      assessmentId: string;
      courseId: string;
    } | undefined;
    backLink?: { href: string; type: "assignment" | "contest" } | undefined;
    canRejudge?: boolean;
    contestId?: string | undefined;
    initialSubmissions?: ProblemSubmissionEntry[];
    problem: ProblemDetail;
    /** TA-configured paths the student's ZIP must contain. Empty array = no constraint. */
    requiredPaths?: string[];
    testcaseSets?: ProblemTestcaseSetSummary[];
  }

  let {
    assessment,
    backLink,
    canRejudge = false,
    contestId,
    initialSubmissions,
    problem,
    requiredPaths = [],
    testcaseSets = []
  }: Props = $props();

  let submissions = $state<ProblemSubmissionEntry[]>(untrack(() => initialSubmissions) ?? []);

  onDestroy(() => {
    pollAbortController?.abort();
  });

  function handleSubmissionComplete(
    result: SubmissionResult,
    language: string,
    sourceCode: string
  ) {
    submissions = [
      {
        language,
        result,
        sourceCode,
        submittedAt: new Date().toISOString()
      },
      ...submissions
    ].slice(0, 50);
    // ProblemLeftPanel auto-flips to the submissions tab when it sees a new
    // head entry in `submissions`.
  }

  // ── Resizable panels ──────────────────────────────────────────────────────
  let leftPanelWidth = $state(42);

  function startResize(e: MouseEvent) {
    e.preventDefault();
    const container = (e.target as HTMLElement).parentElement;
    if (!container) return;

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      leftPanelWidth = Math.max(20, Math.min(80, pct));
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

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

  type StagedFile =
    | { kind: "zip"; file: File; sourceFiles: { path: string; content: string }[] }
    | { kind: "single"; file: File; sourceFiles: { path: string; content: string }[] };

  let staged = $state<StagedFile | null>(null);
  let stagingError = $state<string | null>(null);
  let staging = $state(false);
  let isSubmitting = $state(false);
  let submitError = $state<string | null>(null);
  let dragOver = $state(false);

  let pollAbortController: AbortController | null = null;
  let destroyed = false;
  onDestroy(() => {
    destroyed = true;
  });

  function isPlainSourceFile(name: string): boolean {
    const lower = name.toLowerCase();
    return PLAIN_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  function isZipFile(name: string): boolean {
    return name.toLowerCase().endsWith(".zip");
  }

  async function stageFile(file: File) {
    staging = true;
    stagingError = null;
    submitError = null;
    staged = null;
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
          stagingError = "ZIP contains no readable files.";
          return;
        }
        if (entries.length > MAX_FILES) {
          stagingError = `ZIP contains ${String(entries.length)} files (max ${String(MAX_FILES)}).`;
          return;
        }
        const totalBytes = entries.reduce((sum, e) => sum + e.content.length, 0);
        if (totalBytes > MAX_TOTAL_BYTES) {
          stagingError = `ZIP content exceeds ${String(MAX_TOTAL_BYTES / (1024 * 1024))} MB.`;
          return;
        }
        const requiredCheck = validateRequiredPaths(
          entries.map((e) => e.path),
          requiredPaths
        );
        if (!requiredCheck.ok) {
          const missingList = requiredCheck.errors.map((e) => e.path).join(", ");
          stagingError = m.advancedRequiredPaths_missingList({ paths: missingList });
          return;
        }
        entries.sort((a, b) => a.path.localeCompare(b.path));
        staged = { kind: "zip", file, sourceFiles: entries };
        return;
      }

      if (isPlainSourceFile(file.name)) {
        const content = await file.text();
        if (content.length > MAX_TOTAL_BYTES) {
          stagingError = `File exceeds ${String(MAX_TOTAL_BYTES / (1024 * 1024))} MB.`;
          return;
        }
        const requiredCheck = validateRequiredPaths([file.name], requiredPaths);
        if (!requiredCheck.ok) {
          const missingList = requiredCheck.errors.map((e) => e.path).join(", ");
          stagingError = m.advancedRequiredPaths_missingList({ paths: missingList });
          return;
        }
        staged = {
          kind: "single",
          file,
          sourceFiles: [{ path: file.name, content }]
        };
        return;
      }

      stagingError = "Unsupported file type. Upload a .zip archive or a single source file.";
    } catch (err) {
      stagingError = err instanceof Error ? err.message : "Failed to read file.";
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

  function clearStaged() {
    staged = null;
    stagingError = null;
    submitError = null;
  }

  async function handleSubmit() {
    if (!staged || isSubmitting) return;
    isSubmitting = true;
    submitError = null;

    pollAbortController = new AbortController();
    const { signal } = pollAbortController;

    // Advanced mode ignores `language`/`sourceCode` at the worker boundary; placeholders satisfy the wire schema.
    const placeholderLanguage: Language = "cpp";
    const placeholderSource = "// advanced-mode upload";

    const body = {
      assessment,
      contestId,
      language: placeholderLanguage,
      mode: contestId ? "contest" : assessment ? "assignment" : "practice",
      problemId: problem.id,
      sampleOnly: false,
      sourceCode: placeholderSource,
      sourceFiles: staged.sourceFiles
    };

    try {
      const response = await fetch("/api/submissions", {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
        method: "POST",
        signal
      });

      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(await response.json());
        throw new Error(parsed.success ? parsed.data.message : "Submission failed.");
      }

      const dispatch = submissionDispatchResponseSchema.parse(await response.json());
      const startedAt = Date.now();
      let pollDelay = 500;

      while (Date.now() - startedAt < 30_000) {
        if (destroyed) return;

        const poll = await fetch(dispatch.pollUrl, { cache: "no-store", signal });

        if (!poll.ok) {
          const parsed = apiErrorSchema.safeParse(await poll.json());
          throw new Error(parsed.success ? parsed.data.message : "Polling failed.");
        }

        const operation = submissionOperationSchema.parse(await poll.json());

        if (operation.result) {
          const result = submissionResultSchema.parse(operation.result);
          const previewSource = staged.sourceFiles
            .map((f) => `// --- ${f.path} ---\n${f.content}`)
            .join("\n\n");
          handleSubmissionComplete(result, placeholderLanguage, previewSource);
          staged = null;
          return;
        }

        await new Promise((resolve) => {
          setTimeout(resolve, pollDelay);
        });
        pollDelay = Math.min(pollDelay * 1.5, 3000);
      }

      throw new Error("Submission polling timed out.");
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      submitError = err instanceof Error ? err.message : "Submission failed.";
    } finally {
      isSubmitting = false;
    }
  }
</script>

<!-- Left panel (description / submissions / editorials) -->
<div
  class="flex w-full shrink-0 flex-col overflow-hidden bg-card lg:border-r lg:border-border"
  style="width: {leftPanelWidth}%"
>
  <ProblemLeftPanel
    {backLink}
    {canRejudge}
    bind:submissions
    {problem}
    {testcaseSets}
    editorialFormIdSuffix="adv"
  />
</div>


<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="hidden w-1 cursor-col-resize items-center justify-center bg-border transition-colors hover:bg-primary/40 active:bg-primary/60 lg:flex"
  role="separator"
  aria-orientation="vertical"
  aria-label={m.common_resizePanels()}
  tabindex="0"
  onmousedown={startResize}
  onkeydown={(e) => {
    if (e.key === "ArrowLeft") leftPanelWidth = Math.max(20, leftPanelWidth - 2);
    if (e.key === "ArrowRight") leftPanelWidth = Math.min(80, leftPanelWidth + 2);
  }}
></div>

<!-- Right panel (upload + submit) — desktop only -->
<div class="hidden flex-1 flex-col overflow-hidden lg:flex">
  <div class="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-[color:var(--color-panel)]">
    <!-- Top bar -->
    <div class="flex h-11 items-center justify-between border-b border-border-subtle bg-muted/40 px-3">
      <div class="flex items-center gap-3">
        <span class="text-caption font-semibold text-foreground/70">&lt;/&gt;</span>
        <span class="rounded-full bg-info/15 px-2.5 py-0.5 text-caption font-medium text-info">
          {m.advancedMode_badge()}
        </span>
      </div>
      {#if contestId}
        <span class="rounded-full bg-warning/15 px-2.5 py-0.5 text-caption font-medium text-warning">
          {m.editor_contestMode()}
        </span>
      {:else if assessment}
        <span class="rounded-full bg-info/15 px-2.5 py-0.5 text-caption font-medium text-info">
          {m.editor_assignmentMode()}
        </span>
      {/if}
    </div>

    <!-- Upload area -->
    <div class="flex-1 overflow-y-auto p-6">
      <p class="text-body-sm leading-6 text-muted-foreground">
        {m.advancedMode_uploadInstructions()}
      </p>

      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        role="button"
        tabindex="0"
        class="mt-5 cursor-pointer rounded-xl border-2 border-dashed border-border p-8 text-center transition-[border-color,background-color] duration-fast ease-out-soft {dragOver
          ? 'border-primary bg-primary/5'
          : 'hover:border-primary/40 hover:bg-muted/30'}"
        ondrop={onDrop}
        ondragover={(e) => {
          e.preventDefault();
          dragOver = true;
        }}
        ondragleave={() => (dragOver = false)}
        onclick={() => document.getElementById(`advanced-upload-${problem.id}`)?.click()}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            document.getElementById(`advanced-upload-${problem.id}`)?.click();
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
          id={`advanced-upload-${problem.id}`}
          type="file"
          accept=".zip,.c,.cpp,.cc,.cxx,.h,.hpp,.py,.js,.mjs,.cjs,.ts,.go,.rs,.java,.txt,.md"
          class="hidden"
          onchange={onPick}
        />
      </div>

      {#if stagingError}
        <div
          class="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-body-sm text-destructive"
          data-testid="advanced-staging-error"
        >
          {stagingError}
        </div>
      {/if}

      {#if submitError}
        <div class="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-body-sm text-destructive">
          {submitError}
        </div>
      {/if}
    </div>

    <!-- Action bar -->
    <div
      class="flex items-center justify-between border-t border-border-subtle bg-muted/40 px-4 py-2.5"
    >
      <span class="text-caption font-medium text-muted-foreground tabular-nums">
        {#if staged}
          {m.upload_filesStaged({ count: staged.sourceFiles.length })}
        {:else}
          {m.upload_noFileSelected()}
        {/if}
      </span>
      <div class="flex items-center gap-2">
        <button
          class="rounded-full border border-border px-4 py-1.5 text-body-sm font-medium text-foreground transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!staged || isSubmitting}
          onclick={clearStaged}
          type="button"
        >
          {m.common_clear()}
        </button>
        <button
          class="rounded-full bg-success px-4 py-1.5 text-body-sm font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!staged || isSubmitting}
          onclick={() => void handleSubmit()}
          type="button"
        >
          {isSubmitting ? m.editor_submitting() : m.editor_submitButton()}
        </button>
      </div>
    </div>
  </div>
</div>
