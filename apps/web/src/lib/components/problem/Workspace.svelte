<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { supportedLanguages, type Language, type SubmissionResult } from "@nojv/core";
  import type { ProblemDetail } from "$lib/types";
  import { difficultyColor, formatVerdictLabel, verdictColor } from "$lib/types";
  import { SSE_SUBMISSION_VERDICT } from "@nojv/core";
  import { onSSEEvent } from "$lib/stores/sse";
  import MarkdownRenderer from "../layout/MarkdownRenderer.svelte";
  import ProblemEditor from "./Editor.svelte";
  import SubtaskResults from "./SubtaskResults.svelte";

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

  let { allowedLanguages, assessment, backLink, contestSlug, initialSubmissions, problem }: Props = $props();

  let leftTab = $state<"description" | "editorials" | "submissions">("description");
  let submissions = $state<SubmissionEntry[]>(untrack(() => initialSubmissions) ?? []);
  let viewingIndex = $state<number | null>(null);
  let loadingSourceId = $state<string | null>(null);

  // --- Editorials state ---
  let editorials = $state<EditorialEntry[]>([]);
  let editorialsLoaded = $state(false);
  let editorialsLoading = $state(false);
  let showEditorialForm = $state(false);
  let editorialContent = $state("");
  let editorialLanguage = $state<Language>("python");
  let editorialSubmitting = $state(false);

  let hasAc = $derived(
    submissions.some((s) => s.result.verdict === "accepted")
  );

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

  // Listen for global SSE verdict events for this problem.
  // The existing flow adds submissions locally via handleSubmissionComplete;
  // this SSE listener surfaces a toast for background updates (e.g., other tabs).
  let unsubVerdict: (() => void) | null = null;

  onMount(() => {
    unsubVerdict = onSSEEvent(SSE_SUBMISSION_VERDICT, (data) => {
      if (data.type !== SSE_SUBMISSION_VERDICT) return;
      if (data.problemId !== problem.id) return;
      // Verdict is displayed directly in the workspace UI — no toast needed
    });
  });

  onDestroy(() => {
    unsubVerdict?.();
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

  // ── Resizable panels ──
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
</script>

<!-- Left panel -->
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
          <span class="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {problem.submissionType === "function"
              ? m.problemDetail_functionBadge()
              : problem.submissionType === "zip_project"
                ? "Multi-file"
                : m.problemDetail_fullSourceBadge()}
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
                <pre class="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted px-4 py-3 font-mono text-sm leading-6 text-foreground">{sample.input}</pre>
              </div>
              <div>
                <p class="text-xs font-medium text-muted-foreground">{m.problemDetail_output()}</p>
                <pre class="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted px-4 py-3 font-mono text-sm leading-6 text-foreground">{sample.output}</pre>
              </div>
              {#if sample.explanation}
                <div>
                  <p class="font-semibold">{m.problemDetail_explanation()}:</p>
                  <p class="mt-1 text-muted-foreground">{sample.explanation}</p>
                </div>
              {/if}
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
                <SubtaskResults
                  subtaskResults={entry.result.subtaskResults}
                />
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
              <p class="text-xs font-medium text-muted-foreground">{m.editor_code()}</p>
              {#if loadingSourceId === entry.id && entry.sourceCode === undefined}
                <div class="mt-2 flex items-center gap-2 rounded-lg bg-muted px-4 py-3">
                  <div
                    class="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground"
                  ></div>
                  <span class="text-xs text-muted-foreground">{m.problemDetail_loadingSource()}</span>
                </div>
              {:else}
                <pre
                  class="mt-2 max-h-[50vh] overflow-auto rounded-lg bg-muted px-4 py-3 font-mono text-xs leading-5 text-foreground">{entry.sourceCode ?? ""}</pre>
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
                <label class="mb-1 block text-xs font-medium text-muted-foreground" for="editorial-language">
                  {m.editorials_language()}
                </label>
                <select
                  id="editorial-language"
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
<!-- Resize handle (desktop only) -->
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

<!-- Right panel (desktop only) -->
<div class="hidden flex-1 flex-col overflow-hidden lg:flex">
  <ProblemEditor
    {allowedLanguages}
    {assessment}
    {contestSlug}
    onSubmissionComplete={handleSubmissionComplete}
    {problem}
  />
</div>
