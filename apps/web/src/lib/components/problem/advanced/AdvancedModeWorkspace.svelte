<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import {
    apiErrorSchema,
    submissionDispatchResponseSchema,
    submissionOperationSchema,
    submissionResultSchema,
    SSE_SUBMISSION_VERDICT,
    supportedLanguages,
    type Language,
    type SubmissionResult
  } from "@nojv/core";
  import type { ProblemDetail } from "$lib/types";
  import { difficultyColor, formatVerdictLabel, verdictColor } from "$lib/types";
  import { onSSEEvent } from "$lib/stores/sse";
  import MarkdownRenderer from "../../layout/MarkdownRenderer.svelte";
  import CodeBlock from "../../ui/CodeBlock.svelte";
  import SubtaskResults from "../SubtaskResults.svelte";

  // ── Types (mirrors Workspace.svelte left-pane shape) ──────────────────────
  interface SubmissionEntry {
    id?: string;
    language: string;
    result: SubmissionResult;
    sourceCode?: string;
    submittedAt: string;
  }

  interface EditorialEntry {
    id: string;
    content: string;
    language: string;
    createdAt: string;
    user: { username: string | null; name: string };
  }

  interface Props {
    // `allowedLanguages` is irrelevant for advanced mode (TA image owns
    // execution) but accepted for prop-shape parity with ProblemWorkspace.
    allowedLanguages?: Language[] | undefined;
    assessment?: {
      assessmentSlug: string;
      courseSlug: string;
    } | undefined;
    backLink?: { href: string; type: "assignment" | "contest" } | undefined;
    contestSlug?: string | undefined;
    initialSubmissions?: SubmissionEntry[];
    problem: ProblemDetail;
  }

  let {
    assessment,
    backLink,
    contestSlug,
    initialSubmissions,
    problem
  }: Props = $props();

  const judgeTypeBadge: Record<string, () => string> = {
    checker: () => m.problemDetail_checkerBadge(),
    interactive: () => m.problemDetail_interactiveBadge(),
    standard: () => m.problemDetail_standardBadge()
  };

  const judgeTypeBadgeColor: Record<string, string> = {
    checker: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    interactive: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
    standard: "bg-muted text-muted-foreground"
  };

  let leftTab = $state<"description" | "editorials" | "submissions">("description");
  let submissions = $state<SubmissionEntry[]>(untrack(() => initialSubmissions) ?? []);
  let viewingIndex = $state<number | null>(null);
  let loadingSourceId = $state<string | null>(null);

  // Editorials state
  let editorials = $state<EditorialEntry[]>([]);
  let editorialsLoaded = $state(false);
  let editorialsLoading = $state(false);
  let showEditorialForm = $state(false);
  let editorialContent = $state("");
  let editorialLanguage = $state<Language>("python");
  let editorialSubmitting = $state(false);

  let hasAc = $derived(submissions.some((s) => s.result.verdict === "accepted"));

  async function loadEditorials() {
    if (editorialsLoading) return;
    editorialsLoading = true;
    try {
      const res = await fetch(`/api/problems/${problem.id}/editorials`);
      if (res.ok) {
        editorials = await res.json();
        editorialsLoaded = true;
      }
    } finally {
      editorialsLoading = false;
    }
  }

  async function submitEditorial() {
    if (editorialSubmitting) return;
    editorialSubmitting = true;
    try {
      const res = await fetch(`/api/problems/${problem.id}/editorials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editorialContent, language: editorialLanguage })
      });
      if (res.ok) {
        showEditorialForm = false;
        editorialContent = "";
        await loadEditorials();
      }
    } finally {
      editorialSubmitting = false;
    }
  }

  // SSE verdict listener (parity with Workspace.svelte — UI updates inline,
  // toast-style notifications are handled elsewhere).
  let unsubVerdict: (() => void) | null = null;

  onMount(() => {
    unsubVerdict = onSSEEvent(SSE_SUBMISSION_VERDICT, (data) => {
      if (data.type !== SSE_SUBMISSION_VERDICT) return;
      if (data.problemId !== problem.id) return;
    });
  });

  onDestroy(() => {
    unsubVerdict?.();
    pollAbortController?.abort();
  });

  $effect(() => {
    const idx = viewingIndex;
    if (idx === null) return;

    const entry = submissions[idx];
    if (!entry || entry.sourceCode !== undefined || !entry.id) return;

    const entryId = entry.id;
    loadingSourceId = entryId;
    fetch(`/api/submissions/${entryId}/source`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load source code.");
        return res.json();
      })
      .then((data: { sourceCode: string }) => {
        submissions[idx] = { ...submissions[idx]!, sourceCode: data.sourceCode };
      })
      .catch(() => {
        submissions[idx] = { ...submissions[idx]!, sourceCode: "// Failed to load source code." };
      })
      .finally(() => {
        if (loadingSourceId === entryId) loadingSourceId = null;
      });
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
    leftTab = "submissions";
    viewingIndex = 0;
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

  // ── Upload + submission state ─────────────────────────────────────────────
  // Soft caps for client-side validation. The schema also enforces
  // sourceFiles.length <= 200 and content <= 500_000 bytes per file.
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

    // The submission schema requires:
    //   - `language` ∈ supportedLanguages (no "plaintext")
    //   - `sourceCode` trimmed & non-empty
    // Advanced mode doesn't actually use either — the TA image owns
    // execution — so we send a neutral placeholder language ("cpp") and a
    // short marker sourceCode. The worker still merges sourceFiles into
    // /workspace/submission/ via runAdvancedContainer.
    const placeholderLanguage: Language = "cpp";
    const placeholderSource = "// advanced-mode upload";

    const body = {
      assessment,
      contestSlug,
      language: placeholderLanguage,
      mode: contestSlug ? "contest" : assessment ? "assignment" : "practice",
      problemId: problem.id,
      problemSlug: problem.id,
      sampleOnly: false,
      sourceCode: placeholderSource,
      sourceFiles: staged.sourceFiles
    };

    try {
      const response = await fetch("/api/submissions", {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
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
  <!-- Tab bar -->
  <div class="flex h-10 items-center border-b border-border px-2">
    {#if backLink}
      <a
        class="px-3 py-2.5 text-xs text-muted-foreground transition hover:text-foreground"
        href={backLink.href}
      >
        &larr; {backLink.type === 'contest' ? m.problemDetail_backToContest() : m.problemDetail_backToAssignment()}
      </a>
    {/if}
    <button
      class="px-3 py-2.5 text-xs font-medium transition {leftTab === 'description'
        ? 'border-b-2 border-primary text-foreground'
        : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => (leftTab = "description")}
      type="button"
    >
      {m.problemDetail_description()}
    </button>
    <button
      class="px-3 py-2.5 text-xs font-medium transition {leftTab === 'submissions'
        ? 'border-b-2 border-primary text-foreground'
        : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => (leftTab = "submissions")}
      type="button"
    >
      {m.problemDetail_submissions()}
      {#if submissions.length > 0}
        <span
          class="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums"
        >
          {submissions.length}
        </span>
      {/if}
    </button>
    <button
      class="px-3 py-2.5 text-xs font-medium transition {leftTab === 'editorials'
        ? 'border-b-2 border-primary text-foreground'
        : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => { leftTab = "editorials"; if (hasAc && !editorialsLoaded) loadEditorials(); }}
      type="button"
    >
      {m.editorials_title()}
    </button>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto">
    {#if leftTab === "description"}
      <div class="p-5">
        <h1 class="text-lg font-semibold leading-snug">{problem.title}</h1>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <span
            class="rounded-full px-2.5 py-0.5 text-xs font-medium capitalize {difficultyColor[
              problem.difficulty
            ] ?? 'bg-muted text-muted-foreground'}"
          >
            {problem.difficulty}
          </span>
          <span
            class="rounded-full px-2.5 py-0.5 text-xs font-medium {judgeTypeBadgeColor[
              problem.judgeType
            ] ?? 'bg-muted text-muted-foreground'}"
          >
            {(judgeTypeBadge[problem.judgeType] ?? judgeTypeBadge["standard"]!)()}
          </span>
          <span class="rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-400">
            Advanced Mode
          </span>
          {#each problem.tags as tag (tag)}
            <span class="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
              {tag}
            </span>
          {/each}
        </div>

        <div class="mt-5 text-sm leading-7 text-foreground">
          <MarkdownRenderer content={problem.statement} />
        </div>

        {#if problem.inputFormat}
          <div class="mt-5">
            <p class="text-sm font-semibold">{m.problemDetail_inputFormat()}:</p>
            <div class="mt-1 text-sm leading-7 text-muted-foreground">
              <MarkdownRenderer content={problem.inputFormat} />
            </div>
          </div>
        {/if}

        {#if problem.outputFormat}
          <div class="mt-4">
            <p class="text-sm font-semibold">{m.problemDetail_outputFormat()}:</p>
            <div class="mt-1 text-sm leading-7 text-muted-foreground">
              <MarkdownRenderer content={problem.outputFormat} />
            </div>
          </div>
        {/if}

        {#each problem.samples as sample, index (`sample-${index}`)}
          <div class="mt-6 {index > 0 ? 'border-t border-border pt-6' : ''}">
            <p class="text-base font-semibold">
              {m.problemDetail_sample()} {index + 1}
            </p>
            <div class="mt-3 space-y-3 text-sm">
              <div>
                <p class="text-xs font-medium text-muted-foreground">{m.problemDetail_input()}</p>
                <pre class="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted px-4 py-3 font-mono text-sm leading-6 text-foreground">{sample.stdin}</pre>
              </div>
              <div>
                <p class="text-xs font-medium text-muted-foreground">{m.problemDetail_output()}</p>
                <pre class="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted px-4 py-3 font-mono text-sm leading-6 text-foreground">{sample.expected}</pre>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {:else if leftTab === "submissions"}
      <div class="p-5">
        {#if submissions.length === 0}
          <p class="py-8 text-center text-sm text-muted-foreground">
            {m.problemDetail_noSubmissions()}
          </p>
        {:else if viewingIndex !== null && submissions[viewingIndex]}
          {@const entry = submissions[viewingIndex]!}
          {@const label = formatVerdictLabel(entry.result.verdict)}
          <div>
            <button
              class="mb-4 text-xs text-muted-foreground transition hover:text-foreground"
              onclick={() => (viewingIndex = null)}
              type="button"
            >
              &larr; {m.problemDetail_allSubmissions()}
            </button>

            <div class="flex items-baseline gap-3">
              <span
                class="text-lg font-semibold {verdictColor[entry.result.verdict] ??
                  'text-foreground'}"
              >
                {label}
              </span>
              {#if entry.result.runtimeMs > 0}
                <span class="text-xs text-muted-foreground">
                  Runtime: {String(entry.result.runtimeMs)} ms
                </span>
              {/if}
            </div>

            <div class="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span>{entry.language}</span>
              <span>{String(entry.result.score)}/100</span>
              <span>{new Date(entry.submittedAt).toLocaleTimeString()}</span>
            </div>

            {#if entry.result.subtaskResults && entry.result.subtaskResults.length > 0}
              <div class="mt-4">
                <SubtaskResults subtaskResults={entry.result.subtaskResults} />
              </div>
            {:else if entry.result.caseResults && entry.result.caseResults.length > 0}
              <div class="mt-4 flex flex-wrap items-center gap-1">
                {#each entry.result.caseResults as cr, i (`cr-${i}`)}
                  <span
                    class="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium {cr.passed
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-red-500/15 text-red-600 dark:text-red-400'}"
                  >
                    {cr.passed ? "\u2714" : "\u2718"} Case {i + 1}
                  </span>
                {/each}
              </div>
            {:else if entry.result.feedback}
              <p class="mt-3 text-sm leading-6 text-muted-foreground">
                {entry.result.feedback}
              </p>
            {/if}

            <div class="mt-5">
              {#if loadingSourceId === entry.id && entry.sourceCode === undefined}
                <div class="flex items-center gap-2 rounded-lg bg-muted px-4 py-3">
                  <div
                    class="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground"
                  ></div>
                  <span class="text-xs text-muted-foreground">{m.problemDetail_loadingSource()}</span>
                </div>
              {:else}
                <CodeBlock code={entry.sourceCode ?? ""} language={entry.language} />
              {/if}
            </div>
          </div>
        {:else}
          <div class="grid gap-3">
            {#each submissions as entry, index (`sub-${index}`)}
              {@const label = formatVerdictLabel(entry.result.verdict)}
              <button
                class="rounded-lg border border-border px-4 py-3 text-left transition hover:border-primary/30 hover:bg-accent"
                onclick={() => (viewingIndex = index)}
                type="button"
              >
                <div class="flex items-baseline justify-between gap-3">
                  <span
                    class="text-sm font-semibold {verdictColor[entry.result.verdict] ??
                      'text-foreground'}"
                  >
                    {label}
                  </span>
                  <span class="text-xs text-muted-foreground">
                    {new Date(entry.submittedAt).toLocaleTimeString()}
                  </span>
                </div>
                <div class="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{entry.language}</span>
                  {#if entry.result.runtimeMs > 0}
                    <span>{String(entry.result.runtimeMs)} ms</span>
                  {/if}
                  <span>{String(entry.result.score)}/100</span>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else if leftTab === "editorials"}
      <div class="p-5">
        {#if !hasAc}
          <p class="py-8 text-center text-sm text-muted-foreground">
            {m.editorials_solveFirst()}
          </p>
        {:else if editorialsLoading && !editorialsLoaded}
          <div class="flex items-center justify-center py-8">
            <div
              class="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground"
            ></div>
          </div>
        {:else}
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-sm font-semibold">{m.editorials_title()}</h2>
            <button
              class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
              onclick={() => (showEditorialForm = !showEditorialForm)}
              type="button"
            >
              {m.editorials_write()}
            </button>
          </div>

          {#if showEditorialForm}
            <div class="mb-6 rounded-lg border border-border p-4">
              <div class="mb-3">
                <label class="mb-1 block text-xs font-medium text-muted-foreground" for="editorial-language-adv">
                  {m.editorials_language()}
                </label>
                <select
                  id="editorial-language-adv"
                  class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  bind:value={editorialLanguage}
                >
                  {#each supportedLanguages as lang (lang)}
                    <option value={lang}>{lang}</option>
                  {/each}
                </select>
              </div>
              <div class="mb-3">
                <textarea
                  class="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm leading-6"
                  rows="10"
                  placeholder="Write your editorial in Markdown..."
                  bind:value={editorialContent}
                ></textarea>
              </div>
              <button
                class="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                disabled={editorialSubmitting || editorialContent.length < 10}
                onclick={submitEditorial}
                type="button"
              >
                {editorialSubmitting ? m.editorials_submitting() : m.editorials_submit()}
              </button>
            </div>
          {/if}

          {#if editorials.length === 0}
            <p class="py-8 text-center text-sm text-muted-foreground">
              {m.editorials_empty()}
            </p>
          {:else}
            <div class="grid gap-4">
              {#each editorials as editorial (editorial.id)}
                <div class="rounded-lg border border-border p-4">
                  <div class="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{m.editorials_by()} {editorial.user.name ?? editorial.user.username}</span>
                    <span class="rounded-full bg-muted px-2 py-0.5 font-medium">
                      {editorial.language}
                    </span>
                    <span>{new Date(editorial.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div class="text-sm leading-7">
                    <MarkdownRenderer content={editorial.content} />
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</div>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="hidden w-1 cursor-col-resize items-center justify-center bg-border transition-colors hover:bg-primary/40 active:bg-primary/60 lg:flex"
  role="separator"
  aria-orientation="vertical"
  aria-label="Resize panels"
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
    <div class="flex h-11 items-center justify-between border-b border-border bg-muted/40 px-3">
      <div class="flex items-center gap-3">
        <span class="text-xs font-semibold text-foreground/70">&lt;/&gt;</span>
        <span class="rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-medium text-violet-600 dark:text-violet-400">
          Advanced Mode
        </span>
      </div>
      {#if contestSlug}
        <span class="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
          {m.editor_contestMode()}
        </span>
      {:else if assessment}
        <span class="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-medium text-sky-600 dark:text-sky-400">
          {m.editor_assignmentMode()}
        </span>
      {/if}
    </div>

    <!-- Upload area -->
    <div class="flex-1 overflow-y-auto p-6">
      <p class="text-sm leading-6 text-muted-foreground">
        此題為進階模式（Advanced Mode）。請上傳 ZIP 壓縮檔或單一原始碼檔案。評分由助教提供的容器環境執行。
      </p>

      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        role="button"
        tabindex="0"
        class="mt-5 cursor-pointer rounded-2xl border-2 border-dashed border-border p-8 text-center transition {dragOver
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
          <p class="text-sm font-medium text-muted-foreground">Reading file…</p>
        {:else if staged}
          <p class="font-mono text-sm font-medium text-foreground">{staged.file.name}</p>
          <p class="mt-1 text-xs text-muted-foreground">
            {staged.kind === "zip"
              ? `Extracted ${String(staged.sourceFiles.length)} file${staged.sourceFiles.length === 1 ? "" : "s"}`
              : "Single file"}
          </p>
        {:else}
          <p class="text-sm font-medium text-foreground">
            Drop a <code class="font-mono text-xs">.zip</code> archive or a single source file, or click to browse
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            Accepted: .zip, .c, .cpp, .py, .js, .ts, .go, .rs, .java, .txt, .md (max 200 files, 4 MB)
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
        <div class="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {stagingError}
        </div>
      {/if}

      {#if submitError}
        <div class="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {submitError}
        </div>
      {/if}
    </div>

    <!-- Action bar -->
    <div
      class="flex items-center justify-between border-t border-border bg-muted/40 px-4 py-2.5"
    >
      <span class="text-xs font-medium text-muted-foreground">
        {#if staged}
          {staged.sourceFiles.length} file{staged.sourceFiles.length === 1 ? "" : "s"} staged
        {:else}
          No file selected
        {/if}
      </span>
      <div class="flex items-center gap-2">
        <button
          class="rounded-full border border-border px-4 py-1.5 text-sm font-medium text-foreground transition hover:-translate-y-0.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!staged || isSubmitting}
          onclick={clearStaged}
          type="button"
        >
          Clear
        </button>
        <button
          class="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
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
