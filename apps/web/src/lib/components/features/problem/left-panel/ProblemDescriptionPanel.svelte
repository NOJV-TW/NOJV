<script lang="ts">
  import type { ProblemDetail, ProblemTestcaseSetSummary } from "$lib/types";
  import { tagClass } from "$lib/utils/verdict-style";
  import { m } from "$lib/paraglide/messages.js";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
  import MarkdownRenderer from "$lib/components/primitives/layout/MarkdownRenderer.svelte";
  import SpecialLabels from "./SpecialLabels.svelte";

  interface Props {
    problem: ProblemDetail;
    testcaseSets: ProblemTestcaseSetSummary[];
    dailyAttempts?: { used: number; max: number | null } | undefined;
  }

  let { problem, testcaseSets, dailyAttempts }: Props = $props();
</script>

<div class="p-5">
  <div class="flex items-center gap-3">
    <h1 class="text-body-lg font-semibold leading-snug">
      {formatProblemDisplayName(problem)}
    </h1>
    {#if dailyAttempts}
      {@const remaining =
        dailyAttempts.max == null
          ? null
          : Math.max(0, dailyAttempts.max - dailyAttempts.used)}
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <span class="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
          {m.problemDetail_dailyAttemptsTitle()}
        </span>
        <span
          class="rounded-full px-2.5 py-0.5 text-caption font-medium tabular-nums {remaining === 0
            ? 'bg-destructive/15 text-destructive'
            : remaining !== null && remaining <= 2
              ? 'bg-warning/15 text-warning'
              : 'bg-muted text-muted-foreground'}"
        >
          {dailyAttempts.used} / {dailyAttempts.max ?? "∞"}
        </span>
      </div>
    {/if}
  </div>

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
      <div class="mt-3 space-y-3 text-caption">
        <div>
          <p class="text-caption font-medium text-muted-foreground">{m.problemDetail_input()}</p>
          <pre class="mt-1 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted px-4 py-3 font-mono text-caption leading-6 text-foreground">{sample.input}</pre>
        </div>
        <div>
          <p class="text-caption font-medium text-muted-foreground">{m.problemDetail_output()}</p>
          <pre class="mt-1 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted px-4 py-3 font-mono text-caption leading-6 text-foreground">{sample.output}</pre>
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
          <li class="rounded-md border border-border-subtle px-4 py-3">
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
