<script lang="ts">
  import type { ProblemDetail, ProblemTestcaseSetSummary } from "$lib/types";
  import { tagClass } from "$lib/utils/verdict-style";
  import { m } from "$lib/paraglide/messages.js";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
  import { minutesToHHMM } from "$lib/utils/attempt-reset-time";
  import MarkdownRenderer from "$lib/components/primitives/layout/MarkdownRenderer.svelte";
  import CopyButton from "$lib/components/primitives/ui/CopyButton.svelte";
  import BookmarkButton from "../listings/BookmarkButton.svelte";
  import SpecialLabels from "./SpecialLabels.svelte";

  interface Props {
    problem: ProblemDetail;
    testcaseSets: ProblemTestcaseSetSummary[];
    dailyAttempts?: { used: number; max: number | null; resetMinuteOfDay: number } | undefined;
  }

  let { problem, testcaseSets, dailyAttempts }: Props = $props();
</script>

<div class="p-5">
  <div class="flex items-center gap-3">
    <h1 class="text-body-lg font-semibold leading-snug">
      {formatProblemDisplayName(problem)}
    </h1>
    {#if problem.bookmarked !== undefined}
      <BookmarkButton
        class="ml-auto"
        problemId={problem.id}
        bookmarked={problem.bookmarked}
        size="md"
      />
    {/if}
    {#if dailyAttempts}
      {@const remaining =
        dailyAttempts.max == null ? null : Math.max(0, dailyAttempts.max - dailyAttempts.used)}
      <div class="ml-auto flex shrink-0 flex-col items-end gap-1">
        <div class="flex items-center gap-2">
          <span
            class="text-caption font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {m.problemDetail_dailyAttemptsTitle()}
          </span>
          <span
            class="rounded-full px-2.5 py-0.5 text-caption font-medium tabular-nums {remaining ===
            0
              ? 'bg-destructive/15 text-destructive'
              : remaining !== null && remaining <= 2
                ? 'bg-warning/15 text-warning'
                : 'bg-muted text-muted-foreground'}"
          >
            {dailyAttempts.used} / {dailyAttempts.max ?? "∞"}
          </span>
        </div>
        {#if dailyAttempts.max != null}
          <span
            class="text-caption {remaining === 0
              ? 'text-destructive'
              : 'text-muted-foreground'}"
          >
            {remaining === 0
              ? m.problemDetail_dailyAttemptsExhausted({
                  time: minutesToHHMM(dailyAttempts.resetMinuteOfDay),
                })
              : m.problemDetail_dailyAttemptsResetAt({
                  time: minutesToHHMM(dailyAttempts.resetMinuteOfDay),
                })}
          </span>
        {/if}
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

  <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
    <span class="tabular-nums">
      {m.problemDetail_timeLimit()}: {(problem.timeLimitMs / 1000).toFixed(
        problem.timeLimitMs % 1000 === 0 ? 0 : 1,
      )}s
    </span>
    <span class="tabular-nums">
      {m.problemDetail_memoryLimit()}: {problem.memoryLimitMb} MB
    </span>
  </div>

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
        {m.problemDetail_sample()}
        {index + 1}
      </p>
      <div class="mt-3 space-y-3 text-caption">
        <div>
          <p class="text-caption font-medium text-muted-foreground">
            {m.problemDetail_input()}
          </p>
          <div class="group relative mt-1">
            <pre
              class="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted px-4 py-3 font-mono text-caption leading-6 text-foreground">{sample.input}</pre>
            <CopyButton
              text={sample.input}
              iconOnly
              class="pointer-events-none absolute right-1.5 top-1.5 bg-muted opacity-0 transition-opacity duration-fast ease-out-soft group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
            />
          </div>
        </div>
        <div>
          <p class="text-caption font-medium text-muted-foreground">
            {m.problemDetail_output()}
          </p>
          <div class="group relative mt-1">
            <pre
              class="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted px-4 py-3 font-mono text-caption leading-6 text-foreground">{sample.output}</pre>
            <CopyButton
              text={sample.output}
              iconOnly
              class="pointer-events-none absolute right-1.5 top-1.5 bg-muted opacity-0 transition-opacity duration-fast ease-out-soft group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
            />
          </div>
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
