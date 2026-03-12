<script lang="ts">
  import { untrack } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import type { SubmissionResult } from "@nojv/core";
  import type { ProblemDetail } from "$lib/types";
  import { formatVerdictLabel, verdictColor } from "$lib/types";
  import MarkdownRenderer from "../layout/MarkdownRenderer.svelte";
  import ProblemEditor from "./Editor.svelte";

  const difficultyColor: Record<string, string> = {
    easy: "bg-emerald-500/15 text-emerald-700",
    hard: "bg-red-500/15 text-red-700",
    medium: "bg-amber-500/15 text-amber-700"
  };

  const judgeTypeBadge: Record<string, () => string> = {
    checker: () => m.problemDetail_checkerBadge(),
    interactive: () => m.problemDetail_interactiveBadge(),
    standard: () => m.problemDetail_standardBadge()
  };

  const judgeTypeBadgeColor: Record<string, string> = {
    checker: "bg-violet-500/15 text-violet-700",
    interactive: "bg-sky-500/15 text-sky-700",
    standard: "bg-stone-100 text-stone-600"
  };

  interface SubmissionEntry {
    language: string;
    result: SubmissionResult;
    sourceCode: string;
    submittedAt: string;
  }

  interface Props {
    assessment?: {
      assessmentSlug: string;
      courseSlug: string;
      kind: "assignment" | "exam";
    } | undefined;
    backLink?: { href: string; type: "assignment" | "exam" } | undefined;
    contestSlug?: string | undefined;
    initialSubmissions?: SubmissionEntry[];
    problem: ProblemDetail;
  }

  let { assessment, backLink, contestSlug, initialSubmissions, problem }: Props = $props();

  let leftTab = $state<"description" | "submissions">("description");
  let submissions = $state<SubmissionEntry[]>(untrack(() => initialSubmissions) ?? []);
  let viewingIndex = $state<number | null>(null);

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
    ];
    leftTab = "submissions";
    viewingIndex = 0;
  }
</script>

<!-- Left panel -->
<div
  class="flex w-full shrink-0 flex-col overflow-hidden bg-white lg:w-[42%] lg:border-r lg:border-border"
>
  <!-- Tab bar -->
  <div class="flex items-center border-b border-border px-2">
    {#if backLink}
      <a
        class="px-3 py-2.5 text-xs text-stone-400 transition hover:text-stone-600"
        href={backLink.href}
      >
        &larr; {backLink.type === 'exam' ? m.problemDetail_backToExam() : m.problemDetail_backToAssignment()}
      </a>
    {/if}
    <button
      class="px-3 py-2.5 text-xs font-medium transition {leftTab === 'description'
        ? 'border-b-2 border-primary text-foreground'
        : 'text-stone-400 hover:text-stone-600'}"
      onclick={() => (leftTab = "description")}
      type="button"
    >
      {m.problemDetail_description()}
    </button>
    <button
      class="px-3 py-2.5 text-xs font-medium transition {leftTab === 'submissions'
        ? 'border-b-2 border-primary text-foreground'
        : 'text-stone-400 hover:text-stone-600'}"
      onclick={() => (leftTab = "submissions")}
      type="button"
    >
      {m.problemDetail_submissions()}
      {#if submissions.length > 0}
        <span
          class="ml-1.5 rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] tabular-nums"
        >
          {submissions.length}
        </span>
      {/if}
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
            ] ?? 'bg-stone-100 text-stone-600'}"
          >
            {problem.difficulty}
          </span>
          <span
            class="rounded-full px-2.5 py-0.5 text-xs font-medium {judgeTypeBadgeColor[
              problem.judgeType
            ] ?? 'bg-stone-100 text-stone-600'}"
          >
            {(judgeTypeBadge[problem.judgeType] ?? judgeTypeBadge["standard"]!)()}
          </span>
          <span class="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-500">
            {problem.submissionType === "function"
              ? m.problemDetail_functionBadge()
              : m.problemDetail_fullSourceBadge()}
          </span>
          {#each problem.tags as tag (tag)}
            <span class="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-500">
              {tag}
            </span>
          {/each}
        </div>

        <div class="mt-5 text-sm leading-7 text-stone-700">
          <MarkdownRenderer content={problem.statement} />
        </div>

        {#if problem.inputFormat}
          <div class="mt-5">
            <p class="text-sm font-semibold">{m.problemDetail_inputFormat()}:</p>
            <div class="mt-1 text-sm leading-7 text-stone-600">
              <MarkdownRenderer content={problem.inputFormat} />
            </div>
          </div>
        {/if}

        {#if problem.outputFormat}
          <div class="mt-4">
            <p class="text-sm font-semibold">{m.problemDetail_outputFormat()}:</p>
            <div class="mt-1 text-sm leading-7 text-stone-600">
              <MarkdownRenderer content={problem.outputFormat} />
            </div>
          </div>
        {/if}

        {#each problem.samples as sample, index (`sample-${index}`)}
          <div class="mt-6">
            <p class="text-sm font-semibold">
              {m.problemDetail_sample()} {index + 1}:
            </p>
            <div class="mt-2 rounded-lg bg-stone-50 px-4 py-3 text-sm leading-7">
              <p>
                <span class="font-semibold">{m.problemDetail_input()}:</span>{" "}
                <code class="font-mono text-stone-600">{sample.input}</code>
              </p>
              <p class="mt-1">
                <span class="font-semibold">{m.problemDetail_output()}:</span>{" "}
                <code class="font-mono text-stone-600">{sample.output}</code>
              </p>
              {#if sample.explanation}
                <p class="mt-2 font-semibold">{m.problemDetail_explanation()}:</p>
                <p class="mt-1 text-stone-600">{sample.explanation}</p>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="p-5">
        {#if submissions.length === 0}
          <p class="py-8 text-center text-sm text-stone-400">
            {m.problemDetail_noSubmissions()}
          </p>
        {:else if viewingIndex !== null && submissions[viewingIndex]}
          {@const entry = submissions[viewingIndex]!}
          {@const label = formatVerdictLabel(entry.result.verdict)}
          <div>
            <button
              class="mb-4 text-xs text-stone-400 transition hover:text-stone-600"
              onclick={() => (viewingIndex = null)}
              type="button"
            >
              &larr; {m.problemDetail_allSubmissions()}
            </button>

            <div class="flex items-baseline gap-3">
              <span
                class="text-lg font-semibold {verdictColor[entry.result.verdict] ??
                  'text-stone-700'}"
              >
                {label}
              </span>
              {#if entry.result.runtimeMs > 0}
                <span class="text-xs text-stone-400">
                  Runtime: {String(entry.result.runtimeMs)} ms
                </span>
              {/if}
            </div>

            <div class="mt-1 flex items-center gap-3 text-xs text-stone-400">
              <span>{entry.language}</span>
              <span>{String(entry.result.score)}/100</span>
              <span>{new Date(entry.submittedAt).toLocaleTimeString()}</span>
            </div>

            {#if entry.result.caseResults && entry.result.caseResults.length > 0}
              <div class="mt-4 flex flex-wrap items-center gap-1">
                {#each entry.result.caseResults as cr, i (`cr-${i}`)}
                  <span
                    class="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium {cr.passed
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-red-50 text-red-600'}"
                  >
                    {cr.passed ? "\u2714" : "\u2718"} Case {i + 1}
                  </span>
                {/each}
              </div>
            {:else if entry.result.feedback}
              <p class="mt-3 text-sm leading-6 text-stone-500">
                {entry.result.feedback}
              </p>
            {/if}

            <div class="mt-5">
              <p class="text-xs font-medium text-stone-400">{m.editor_code()}</p>
              <pre
                class="mt-2 max-h-[50vh] overflow-auto rounded-lg bg-stone-50 px-4 py-3 font-mono text-xs leading-5 text-stone-700">{entry.sourceCode}</pre>
            </div>
          </div>
        {:else}
          <div class="grid gap-3">
            {#each submissions as entry, index (`sub-${index}`)}
              {@const label = entry.result.verdict
                .replace(/_/g, " ")
                .replace(/\b\w/g, (char) => char.toUpperCase())}
              <button
                class="rounded-lg border border-stone-200 px-4 py-3 text-left transition hover:border-stone-300 hover:bg-stone-50"
                onclick={() => (viewingIndex = index)}
                type="button"
              >
                <div class="flex items-baseline justify-between gap-3">
                  <span
                    class="text-sm font-semibold {verdictColor[entry.result.verdict] ??
                      'text-stone-700'}"
                  >
                    {label}
                  </span>
                  <span class="text-xs text-stone-400">
                    {new Date(entry.submittedAt).toLocaleTimeString()}
                  </span>
                </div>
                <div class="mt-1 flex items-center gap-3 text-xs text-stone-400">
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
    {/if}
  </div>
</div>

<!-- Right panel (desktop only) -->
<div class="hidden flex-1 flex-col overflow-hidden lg:flex">
  <ProblemEditor
    {assessment}
    {contestSlug}
    onSubmissionComplete={handleSubmissionComplete}
    {problem}
  />
</div>
