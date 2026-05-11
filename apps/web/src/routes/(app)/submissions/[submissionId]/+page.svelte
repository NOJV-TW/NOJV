<script lang="ts">
  import { ArrowLeft, Check, X } from "@lucide/svelte";
  import CodeBlock from "$lib/components/ui/CodeBlock.svelte";
  import Section from "$lib/components/ui/Section.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { formatVerdictLabel, verdictColor } from "$lib/types";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";

  let { data } = $props();

  const submission = $derived(data.submission);
  const result = $derived(submission.result);
  const verdict = $derived(result?.verdict ?? submission.status);
  const verdictLabel = $derived(formatVerdictLabel(verdict));
  const verdictClass = $derived(verdictColor[verdict] ?? "text-foreground");

  const submittedAt = $derived(new Date(submission.createdAt).toLocaleString());
  const runtimeMs = $derived(submission.runtimeMs ?? result?.runtimeMs ?? null);
  const memoryKb = $derived(submission.memoryKb);

  const caseResults = $derived(result?.caseResults ?? []);
  const subtaskResults = $derived(result?.subtaskResults ?? []);
  const hasAnyCaseBreakdown = $derived(caseResults.length > 0 || subtaskResults.length > 0);

  let selectedCaseIndex = $state(0);
  const selectedCase = $derived(caseResults[selectedCaseIndex]);
</script>

<Section>
  {#snippet header()}
    <h1 class="text-title-lg">
      <span class="text-muted-foreground">{formatProblemDisplayName(submission.problem)}</span>
      <span class="mx-2 text-muted-foreground">·</span>
      <span class={verdictClass}>{verdictLabel}</span>
    </h1>
    <p>{m.submissionDetail_overview()}</p>
  {/snippet}

  <div class="flex flex-col gap-6">
    <!-- Breadcrumb / back link -->
    <div class="flex items-center gap-3 text-body-sm">
      <a
        class="inline-flex items-center gap-1 text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-foreground"
        href={`/problems/${submission.problem.id}`}
      >
        <ArrowLeft class="size-4" />
        {m.submissionDetail_backToProblem()}
      </a>
    </div>

    <!-- Context badge (contest / assessment / exam) -->
    {#if submission.context.kind === "contest"}
      <p
        class="rounded-lg border border-border-subtle bg-muted/30 px-4 py-3 text-body-sm text-muted-foreground"
      >
        {m.submissionDetail_contextContest({ contestTitle: submission.context.contestTitle })}
      </p>
    {:else if submission.context.kind === "assessment"}
      <p
        class="rounded-lg border border-border-subtle bg-muted/30 px-4 py-3 text-body-sm text-muted-foreground"
      >
        {m.submissionDetail_contextAssessment({
          assessmentTitle: submission.context.assessmentTitle,
          courseTitle: submission.context.courseTitle
        })}
      </p>
    {:else if submission.context.kind === "exam"}
      <p
        class="rounded-lg border border-border-subtle bg-muted/30 px-4 py-3 text-body-sm text-muted-foreground"
      >
        {m.submissionDetail_contextExam({
          examTitle: submission.context.examTitle,
          courseTitle: submission.context.courseTitle
        })}
      </p>
    {/if}

    {#if submission.sampleOnly}
      <p
        class="rounded-lg border border-border-subtle bg-warning/10 px-4 py-3 text-body-sm text-warning"
      >
        {m.submissionDetail_sampleOnlyNotice()}
      </p>
    {/if}

    <!-- Metrics grid -->
    <dl
      class="grid gap-4 rounded-xl border border-border-subtle bg-muted/20 p-5 sm:grid-cols-2 lg:grid-cols-5"
    >
      <div class="flex flex-col gap-1">
        <dt class="text-caption uppercase tracking-wide text-muted-foreground">
          {m.submissionDetail_score()}
        </dt>
        <dd class="text-title-md tabular-nums">
          {submission.score}<span class="text-body-sm text-muted-foreground">/100</span>
        </dd>
      </div>
      <div class="flex flex-col gap-1">
        <dt class="text-caption uppercase tracking-wide text-muted-foreground">
          {m.submissionDetail_runtime()}
        </dt>
        <dd class="text-title-md tabular-nums">
          {#if runtimeMs !== null && runtimeMs > 0}
            {runtimeMs}<span class="text-body-sm text-muted-foreground"> ms</span>
          {:else}
            <span class="text-muted-foreground">—</span>
          {/if}
        </dd>
      </div>
      <div class="flex flex-col gap-1">
        <dt class="text-caption uppercase tracking-wide text-muted-foreground">
          {m.submissionDetail_memory()}
        </dt>
        <dd class="text-title-md tabular-nums">
          {#if memoryKb !== null && memoryKb > 0}
            {(memoryKb / 1024).toFixed(1)}<span class="text-body-sm text-muted-foreground">
              MB</span
            >
          {:else}
            <span class="text-muted-foreground">—</span>
          {/if}
        </dd>
      </div>
      <div class="flex flex-col gap-1">
        <dt class="text-caption uppercase tracking-wide text-muted-foreground">
          {m.submissionDetail_language()}
        </dt>
        <dd class="text-title-md">{submission.language}</dd>
      </div>
      <div class="flex flex-col gap-1">
        <dt class="text-caption uppercase tracking-wide text-muted-foreground">
          {m.submissionDetail_submittedAt()}
        </dt>
        <dd class="text-body-sm tabular-nums">{submittedAt}</dd>
      </div>
    </dl>

    <!-- Staff notice + submitter -->
    {#if submission.viewerIsStaff && submission.submitter}
      <div class="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-body-sm">
        <p class="text-primary">{m.submissionDetail_viewingAsStaff()}</p>
        <p class="mt-1 text-muted-foreground">
          <span class="text-caption uppercase tracking-wide"
            >{m.submissionDetail_submitter()}:</span
          >
          <span class="ml-2 font-medium text-foreground"
            >{submission.submitter.name} (@{submission.submitter.username})</span
          >
        </p>
      </div>
    {/if}

    <!-- Feedback -->
    {#if result?.feedback}
      <div>
        <h2 class="mb-2 text-title-sm">{m.submissionDetail_feedback()}</h2>
        <pre
          class="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border-subtle bg-muted/30 px-4 py-3 font-mono text-body-sm text-foreground">{result.feedback}</pre>
      </div>
    {:else if !result}
      <p
        class="rounded-lg border border-dashed border-border-strong bg-muted/20 px-4 py-6 text-center text-body-sm text-muted-foreground"
      >
        {m.submissionDetail_noVerdictYet()}
      </p>
    {/if}

    <!-- Subtasks -->
    {#if subtaskResults.length > 0}
      <div>
        <h2 class="mb-3 text-title-sm">{m.submissionDetail_subtasks()}</h2>
        <div class="grid gap-2">
          {#each subtaskResults as st, idx (`st-${idx}-${st.testcaseSetId}`)}
            <div
              class="flex items-center justify-between gap-4 rounded-lg border border-border-subtle bg-[color:var(--color-panel)]/60 px-4 py-3"
            >
              <div class="flex min-w-0 items-center gap-3">
                <span
                  class="flex size-6 shrink-0 items-center justify-center rounded-full {st.passed
                    ? 'bg-success/15 text-success'
                    : 'bg-destructive/15 text-destructive'}"
                >
                  {#if st.passed}
                    <Check class="size-3.5" />
                  {:else}
                    <X class="size-3.5" />
                  {/if}
                </span>
                <span class="truncate text-body-sm font-medium text-foreground">{st.label}</span>
              </div>
              <span class="shrink-0 text-caption text-muted-foreground tabular-nums">
                {m.submissionDetail_subtaskWeight({ weight: st.weight })} · {st.cases.length}
                cases
              </span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Per-case breakdown -->
    {#if hasAnyCaseBreakdown && caseResults.length > 0}
      <div>
        <h2 class="mb-3 text-title-sm">{m.submissionDetail_perCaseBreakdown()}</h2>
        <div class="flex flex-wrap items-center gap-1.5">
          {#each caseResults as cr, idx (`cr-${idx}`)}
            <button
              class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-caption font-medium transition-[background-color,color] duration-fast ease-out-soft {selectedCaseIndex ===
              idx
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => (selectedCaseIndex = idx)}
              type="button"
            >
              <span class={cr.passed ? "text-success" : "text-destructive"}>
                {cr.passed ? "\u2714" : "\u2718"}
              </span>
              {m.submissionDetail_caseLabel({ index: idx + 1 })}
              <span class="text-muted-foreground tabular-nums">· {cr.timeMs} ms</span>
            </button>
          {/each}
        </div>

        {#if selectedCase}
          <div class="mt-4 grid gap-3">
            <div>
              <p class="text-caption font-medium text-muted-foreground">
                {m.submissionDetail_stdout()}
              </p>
              <pre
                class="mt-1 max-h-64 overflow-auto rounded-lg bg-muted px-3 py-2 font-mono text-body-sm text-foreground">{selectedCase.stdout ||
                  "(empty)"}</pre>
            </div>
            {#if selectedCase.stderr}
              <div>
                <p class="text-caption font-medium text-destructive">
                  {m.submissionDetail_stderr()}
                </p>
                <pre
                  class="mt-1 max-h-64 overflow-auto rounded-lg bg-destructive/10 px-3 py-2 font-mono text-body-sm text-destructive">{selectedCase.stderr}</pre>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {:else if result && !hasAnyCaseBreakdown}
      <p
        class="rounded-lg border border-dashed border-border-strong bg-muted/20 px-4 py-6 text-center text-body-sm text-muted-foreground"
      >
        {m.submissionDetail_noCaseResults()}
      </p>
    {/if}

    <!-- Source code -->
    <div>
      <h2 class="mb-3 text-title-sm">{m.submissionDetail_sourceCode()}</h2>
      <CodeBlock code={submission.sourceCode} language={submission.language} maxHeight="60vh" />
    </div>
  </div>
</Section>
