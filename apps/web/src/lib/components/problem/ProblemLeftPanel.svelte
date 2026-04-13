<script lang="ts">
  import { untrack } from "svelte";
  import { supportedLanguages, type Language } from "@nojv/core";
  import type {
    ProblemDetail,
    ProblemEditorialEntry,
    ProblemSubmissionEntry,
    ProblemTestcaseSetSummary
  } from "$lib/types";
  import { formatVerdictLabel, tagClass, verdictColor } from "$lib/types";
  import { m } from "$lib/paraglide/messages.js";
  import MarkdownRenderer from "../layout/MarkdownRenderer.svelte";
  import CodeBlock from "../ui/CodeBlock.svelte";
  import SpecialLabels from "./SpecialLabels.svelte";
  import SubtaskResults from "./SubtaskResults.svelte";

  export interface ProblemLeftPanelProps {
    backLink?: { href: string; type: "assignment" | "contest" } | undefined;
    /**
     * Bindable submission history. Parents (the right-pane Editor / advanced
     * uploader) mutate this array to push freshly-completed submissions; the
     * left pane owns the rendering and the lazy source-code fetch effect.
     */
    submissions?: ProblemSubmissionEntry[];
    /** Initial active tab when the panel mounts. Parents pass the default and
     * then leave tab state alone — the panel auto-flips to "submissions" when
     * it detects a new entry at the head of `submissions`. */
    leftTab?: "description" | "editorials" | "submissions";
    /** Initial submission focus when the panel mounts. */
    viewingIndex?: number | null;
    problem: ProblemDetail;
    testcaseSets?: ProblemTestcaseSetSummary[];
    /** Unique DOM id suffix so two panels can coexist on the same page without colliding ids. */
    editorialFormIdSuffix?: string;
  }

  let {
    backLink,
    submissions = $bindable([]),
    leftTab: initialLeftTab = "description",
    viewingIndex: initialViewingIndex = null,
    problem,
    testcaseSets = [],
    editorialFormIdSuffix = ""
  }: ProblemLeftPanelProps = $props();

  // Tab + focused-entry are panel-owned one-way state. Parents never read them
  // back, so we drop the $bindable round-trip and instead auto-flip when a new
  // submission lands at the head of `submissions` (see effect below). The
  // props seed the initial value only; untrack() makes the capture explicit.
  let leftTab = $state<"description" | "editorials" | "submissions">(
    untrack(() => initialLeftTab)
  );
  let viewingIndex = $state<number | null>(untrack(() => initialViewingIndex));

  // Detect a newly-prepended submission by watching the first entry's marker
  // (id when the server has assigned one, otherwise submittedAt). On mount we
  // seed the baseline so the initial render does NOT count as a new submit.
  let lastKnownHead = $state<string | null>(
    untrack(() => submissions[0]?.id ?? submissions[0]?.submittedAt ?? null)
  );
  $effect(() => {
    const head = submissions[0]?.id ?? submissions[0]?.submittedAt ?? null;
    if (head !== lastKnownHead) {
      lastKnownHead = head;
      if (head !== null) {
        leftTab = "submissions";
        viewingIndex = 0;
      }
    }
  });

  let loadingSourceId = $state<string | null>(null);

  // ── Editorials state ──────────────────────────────────────────────────────
  let editorials = $state<ProblemEditorialEntry[]>([]);
  let editorialsLoaded = $state(false);
  let editorialsLoading = $state(false);
  let showEditorialForm = $state(false);
  let editorialContent = $state("");
  let editorialLanguage = $state<Language>("python");
  let editorialSubmitting = $state(false);

  let hasAc = $derived(submissions.some((s) => s.result.verdict === "accepted"));

  const editorialLanguageId = $derived(
    `editorial-language${editorialFormIdSuffix ? `-${editorialFormIdSuffix}` : ""}`
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

  // Lazy-fetch the source code for the submission currently in focus. We key
  // the work off the entry ID (not the array index) and gate writes on a
  // per-effect-run `cancelled` flag so that:
  //   1. if `viewingIndex` changes before the request resolves, the late
  //      response is dropped (the cleanup callback flips `cancelled`),
  //   2. if the parent re-shuffles `submissions` between dispatch and
  //      resolution, we re-locate the target entry by ID at write time, and
  //   3. if the entry has been dropped entirely (e.g. truncated off the
  //      50-entry tail), the response is discarded silently.
  $effect(() => {
    const idx = viewingIndex;
    if (idx === null) return;

    const entry = submissions[idx];
    if (!entry || entry.sourceCode !== undefined || !entry.id) return;

    const entryId = entry.id;
    let cancelled = false;
    loadingSourceId = entryId;

    fetch(`/api/submissions/${entryId}/source`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load source code.");
        return res.json() as Promise<{ sourceCode: string }>;
      })
      .then((data) => {
        if (cancelled) return;
        const currentIdx = submissions.findIndex((s) => s.id === entryId);
        if (currentIdx === -1) return;
        submissions[currentIdx] = { ...submissions[currentIdx]!, sourceCode: data.sourceCode };
      })
      .catch(() => {
        if (cancelled) return;
        const currentIdx = submissions.findIndex((s) => s.id === entryId);
        if (currentIdx === -1) return;
        submissions[currentIdx] = {
          ...submissions[currentIdx]!,
          sourceCode: "// Failed to load source code."
        };
      })
      .finally(() => {
        if (!cancelled && loadingSourceId === entryId) loadingSourceId = null;
      });

    return () => {
      cancelled = true;
    };
  });
</script>

<!-- Tab bar -->
<div class="flex h-11 items-center border-b border-border-subtle px-2">
  {#if backLink}
    <a
      class="px-3 py-2.5 text-caption text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-foreground"
      href={backLink.href}
    >
      &larr; {backLink.type === 'contest' ? m.problemDetail_backToContest() : m.problemDetail_backToAssignment()}
    </a>
  {/if}
  <button
    class="px-3 py-2.5 text-caption font-medium transition-[color,border-color] duration-fast ease-out-soft {leftTab === 'description'
      ? 'border-b-2 border-primary text-foreground'
      : 'text-muted-foreground hover:text-foreground'}"
    onclick={() => (leftTab = "description")}
    type="button"
  >
    {m.problemDetail_description()}
  </button>
  <button
    class="px-3 py-2.5 text-caption font-medium transition-[color,border-color] duration-fast ease-out-soft {leftTab === 'submissions'
      ? 'border-b-2 border-primary text-foreground'
      : 'text-muted-foreground hover:text-foreground'}"
    onclick={() => (leftTab = "submissions")}
    type="button"
  >
    {m.problemDetail_submissions()}
    {#if submissions.length > 0}
      <span
        class="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-micro tabular-nums"
      >
        {submissions.length}
      </span>
    {/if}
  </button>
  <button
    class="px-3 py-2.5 text-caption font-medium transition-[color,border-color] duration-fast ease-out-soft {leftTab === 'editorials'
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
      <h1 class="text-body-lg font-semibold leading-snug">{problem.title}</h1>

      {#if problem.tags.length > 0}
        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          {#each problem.tags as tag (tag)}
            <span
              class="inline-flex items-center rounded-full border px-2 py-0.5 text-caption font-medium capitalize {tagClass()}"
            >
              {tag}
            </span>
          {/each}
        </div>
      {/if}

      <SpecialLabels
        problemType={problem.type}
        judgeType={problem.judgeType}
        difficulty={problem.difficulty}
      />

      <div class="mt-5 text-body-sm leading-7 text-foreground">
        <MarkdownRenderer content={problem.statement} />
      </div>

      {#if problem.inputFormat}
        <div class="mt-5">
          <p class="text-body-sm font-semibold">{m.problemDetail_inputFormat()}:</p>
          <div class="mt-1 text-body-sm leading-7 text-muted-foreground">
            <MarkdownRenderer content={problem.inputFormat} />
          </div>
        </div>
      {/if}

      {#if problem.outputFormat}
        <div class="mt-4">
          <p class="text-body-sm font-semibold">{m.problemDetail_outputFormat()}:</p>
          <div class="mt-1 text-body-sm leading-7 text-muted-foreground">
            <MarkdownRenderer content={problem.outputFormat} />
          </div>
        </div>
      {/if}

      {#each problem.samples as sample, index (`sample-${index}`)}
        <div class="mt-6 {index > 0 ? 'border-t border-border-subtle pt-6' : ''}">
          <p class="text-body font-semibold">
            {m.problemDetail_sample()} {index + 1}
          </p>
          <div class="mt-3 space-y-3 text-body-sm">
            <div>
              <p class="text-caption font-medium text-muted-foreground">{m.problemDetail_input()}</p>
              <pre class="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted px-4 py-3 font-mono text-body-sm leading-6 text-foreground">{sample.input}</pre>
            </div>
            <div>
              <p class="text-caption font-medium text-muted-foreground">{m.problemDetail_output()}</p>
              <pre class="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted px-4 py-3 font-mono text-body-sm leading-6 text-foreground">{sample.output}</pre>
            </div>
          </div>
        </div>
      {/each}

      {#if testcaseSets.some((s) => s.weight > 0)}
        {@const subtaskSets = testcaseSets
          .filter((s) => s.weight > 0)
          .sort((a, b) => a.ordinal - b.ordinal)}
        {@const totalWeight = subtaskSets.reduce((sum, s) => sum + s.weight, 0)}
        <div class="mt-6 border-t border-border-subtle pt-6">
          <p class="text-body font-semibold">{m.problemDetail_testcaseSets()}</p>
          <ul class="mt-3 space-y-3">
            {#each subtaskSets as set, idx (set.id)}
              <li class="rounded-lg border border-border-subtle px-4 py-3">
                <div class="flex items-baseline justify-between gap-3">
                  <span class="text-caption font-medium text-muted-foreground tabular-nums">
                    #subtask{idx + 1}
                  </span>
                  <span class="text-caption font-medium text-muted-foreground tabular-nums">
                    {totalWeight > 0 ? Math.round((set.weight / totalWeight) * 100) : 0}%
                  </span>
                </div>
                {#if set.description}
                  <p class="mt-2 text-body-sm leading-6 text-foreground">
                    {set.description}
                  </p>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  {:else if leftTab === "submissions"}
    <div class="p-5">
      {#if submissions.length === 0}
        <p class="py-8 text-center text-body-sm text-muted-foreground">
          {m.problemDetail_noSubmissions()}
        </p>
      {:else if viewingIndex !== null && submissions[viewingIndex]}
        {@const entry = submissions[viewingIndex]!}
        {@const label = formatVerdictLabel(entry.result.verdict)}
        <div>
          <button
            class="mb-4 text-caption text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-foreground"
            onclick={() => (viewingIndex = null)}
            type="button"
          >
            &larr; {m.problemDetail_allSubmissions()}
          </button>

          <div class="flex items-baseline gap-3">
            <span
              class="text-body-lg font-semibold {verdictColor[entry.result.verdict] ??
                'text-foreground'}"
            >
              {label}
            </span>
            {#if entry.result.runtimeMs > 0}
              <span class="text-caption text-muted-foreground tabular-nums">
                Runtime: {String(entry.result.runtimeMs)} ms
              </span>
            {/if}
          </div>

          <div class="mt-1 flex items-center gap-3 text-caption text-muted-foreground">
            <span>{entry.language}</span>
            <span class="tabular-nums">{String(entry.result.score)}/100</span>
            <span class="tabular-nums">{new Date(entry.submittedAt).toLocaleTimeString()}</span>
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
                  class="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-caption font-medium {cr.passed
                    ? 'bg-success/15 text-success'
                    : 'bg-destructive/15 text-destructive'}"
                >
                  {cr.passed ? "\u2714" : "\u2718"} Case {i + 1}
                </span>
              {/each}
            </div>
          {:else if entry.result.feedback}
            <p class="mt-3 text-body-sm leading-6 text-muted-foreground">
              {entry.result.feedback}
            </p>
          {/if}

          <div class="mt-5">
            {#if loadingSourceId === entry.id && entry.sourceCode === undefined}
              <div class="flex items-center gap-2 rounded-lg bg-muted px-4 py-3">
                <div
                  class="size-4 animate-spin rounded-full border-2 border-border border-t-foreground"
                ></div>
                <span class="text-caption text-muted-foreground">{m.problemDetail_loadingSource()}</span>
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
              class="rounded-lg border border-border-subtle px-4 py-3 text-left transition-[transform,box-shadow,background-color,border-color] duration-fast ease-out-soft hover:border-primary/30 hover:bg-accent hover:shadow-rest"
              onclick={() => (viewingIndex = index)}
              type="button"
            >
              <div class="flex items-baseline justify-between gap-3">
                <span
                  class="text-body-sm font-semibold {verdictColor[entry.result.verdict] ??
                    'text-foreground'}"
                >
                  {label}
                </span>
                <span class="text-caption text-muted-foreground tabular-nums">
                  {new Date(entry.submittedAt).toLocaleTimeString()}
                </span>
              </div>
              <div class="mt-1 flex items-center gap-3 text-caption text-muted-foreground">
                <span>{entry.language}</span>
                {#if entry.result.runtimeMs > 0}
                  <span class="tabular-nums">{String(entry.result.runtimeMs)} ms</span>
                {/if}
                <span class="tabular-nums">{String(entry.result.score)}/100</span>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {:else if leftTab === "editorials"}
    <div class="p-5">
      {#if !hasAc}
        <p class="py-8 text-center text-body-sm text-muted-foreground">
          {m.editorials_solveFirst()}
        </p>
      {:else if editorialsLoading && !editorialsLoaded}
        <div class="flex items-center justify-center py-8">
          <div
            class="size-5 animate-spin rounded-full border-2 border-border border-t-foreground"
          ></div>
        </div>
      {:else}
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-body-sm font-semibold">{m.editorials_title()}</h2>
          <button
            class="rounded-md bg-primary px-3 py-1.5 text-caption font-medium text-primary-foreground transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:bg-primary/90"
            onclick={() => (showEditorialForm = !showEditorialForm)}
            type="button"
          >
            {m.editorials_write()}
          </button>
        </div>

        {#if showEditorialForm}
          <div class="mb-6 rounded-lg border border-border-subtle p-4">
            <div class="mb-3">
              <label class="mb-1 block text-caption font-medium text-muted-foreground" for={editorialLanguageId}>
                {m.editorials_language()}
              </label>
              <select
                id={editorialLanguageId}
                class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-body-sm"
                bind:value={editorialLanguage}
              >
                {#each supportedLanguages as lang (lang)}
                  <option value={lang}>{lang}</option>
                {/each}
              </select>
            </div>
            <div class="mb-3">
              <textarea
                class="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-body-sm leading-6"
                rows="10"
                placeholder="Write your editorial in Markdown..."
                bind:value={editorialContent}
              ></textarea>
            </div>
            <button
              class="rounded-md bg-primary px-4 py-1.5 text-caption font-medium text-primary-foreground transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:bg-primary/90 disabled:opacity-50"
              disabled={editorialSubmitting || editorialContent.length < 10}
              onclick={submitEditorial}
              type="button"
            >
              {editorialSubmitting ? m.editorials_submitting() : m.editorials_submit()}
            </button>
          </div>
        {/if}

        {#if editorials.length === 0}
          <p class="py-8 text-center text-body-sm text-muted-foreground">
            {m.editorials_empty()}
          </p>
        {:else}
          <div class="grid gap-4">
            {#each editorials as editorial (editorial.id)}
              <div class="rounded-lg border border-border-subtle p-4">
                <div class="mb-3 flex items-center gap-2 text-caption text-muted-foreground">
                  <span>{m.editorials_by()} {editorial.user.name ?? editorial.user.username}</span>
                  <span class="rounded-full bg-muted px-2 py-0.5 font-medium">
                    {editorial.language}
                  </span>
                  <span class="tabular-nums">{new Date(editorial.createdAt).toLocaleDateString()}</span>
                </div>
                <div class="text-body-sm leading-7">
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
