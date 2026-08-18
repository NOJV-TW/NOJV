<script lang="ts">
  import { MemoryStick, Timer } from "@lucide/svelte";
  import type { ProblemType } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import HelpTooltip from "$lib/components/primitives/ui/HelpTooltip.svelte";

  interface Props {
    problemType: ProblemType;
    judgeType: string;
    timeLimitMs: number;
    memoryLimitMb: number;
    isCompact?: boolean;
    which?: "both" | "problem-type" | "judge-method";
  }

  let {
    problemType,
    judgeType,
    timeLimitMs,
    memoryLimitMb,
    isCompact = false,
    which = "both",
  }: Props = $props();

  let showProblemType = $derived(which === "both" || which === "problem-type");
  let showJudgeMethodRequested = $derived(which === "both" || which === "judge-method");

  const problemTypeLabel: Record<ProblemType, () => string> = {
    full_source: () => m.problemDetail_fullSourceBadge(),
    multi_file: () => m.problemDetail_multiFileBadge(),
    special_env: () => m.problemDetail_specialEnvBadge(),
  };

  const problemTypeHelp: Record<ProblemType, () => string> = {
    full_source: () => m.problemDetail_fullSourceHelp(),
    multi_file: () => m.problemDetail_multiFileHelp(),
    special_env: () => m.problemDetail_specialEnvHelp(),
  };

  const problemTypeColor: Record<ProblemType, string> = {
    full_source: "bg-muted text-muted-foreground",
    multi_file: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
    special_env: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  };

  const judgeTypeLabel: Record<string, () => string> = {
    standard: () => m.problemDetail_standardBadge(),
    checker: () => m.problemDetail_checkerBadge(),
    interactive: () => m.problemDetail_interactiveBadge(),
  };

  const judgeTypeHelp: Record<string, () => string> = {
    standard: () => m.problemDetail_standardHelp(),
    checker: () => m.problemDetail_checkerHelp(),
    interactive: () => m.problemDetail_interactiveHelp(),
  };

  const judgeTypeColor: Record<string, string> = {
    standard: "bg-muted text-muted-foreground",
    checker: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    interactive: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  };

  let problemLabel = $derived(problemTypeLabel[problemType]());
  let problemHelp = $derived(problemTypeHelp[problemType]());
  let problemColor = $derived(problemTypeColor[problemType]);

  let judgeLabel = $derived((judgeTypeLabel[judgeType] ?? judgeTypeLabel["standard"]!)());
  let judgeHelp = $derived((judgeTypeHelp[judgeType] ?? judgeTypeHelp["standard"]!)());
  let judgeColor = $derived(judgeTypeColor[judgeType] ?? judgeTypeColor["standard"]!);

  let showJudgeMethod = $derived(showJudgeMethodRequested && problemType !== "special_env");
</script>

{#if isCompact}
  <span class="inline-flex flex-wrap items-center gap-1">
    {#if showProblemType}
      <span class="rounded-full px-2 py-0.5 text-micro font-medium {problemColor}">
        {problemLabel}
      </span>
    {/if}
    {#if showJudgeMethod}
      <span class="rounded-full px-2 py-0.5 text-micro font-medium {judgeColor}">
        {judgeLabel}
      </span>
    {/if}
  </span>
{:else}
  <div
    class="mt-3 flex flex-wrap gap-x-8 gap-y-2 rounded-md border border-border-subtle bg-muted/30 px-3 py-2"
  >
    <span class="inline-flex items-center gap-1.5 text-caption">
      <Timer
        class="size-3.5 shrink-0 text-muted-foreground"
        aria-label={m.problemDetail_timeLimit()}
        title={m.problemDetail_timeLimit()}
      />
      <span class="font-mono font-semibold tabular-nums text-foreground">
        {(timeLimitMs / 1000).toFixed(timeLimitMs % 1000 === 0 ? 0 : 1)}s
      </span>
    </span>
    <span class="inline-flex items-center gap-1.5 text-caption">
      <MemoryStick
        class="size-3.5 shrink-0 text-muted-foreground"
        aria-label={m.problemDetail_memoryLimit()}
        title={m.problemDetail_memoryLimit()}
      />
      <span class="font-mono font-semibold tabular-nums text-foreground">
        {memoryLimitMb} MB
      </span>
    </span>
    {#if showProblemType}
      <div class="flex items-center gap-2">
        <span class="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
          {m.problemDetail_problemTypeTitle()}
        </span>
        <span class="rounded-full px-2.5 py-0.5 text-caption font-medium {problemColor}">
          {problemLabel}
        </span>
        <HelpTooltip text={problemHelp} />
      </div>
    {/if}
    {#if showJudgeMethod}
      <div class="flex items-center gap-2">
        <span class="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
          {m.problemDetail_judgeMethodTitle()}
        </span>
        <span class="rounded-full px-2.5 py-0.5 text-caption font-medium {judgeColor}">
          {judgeLabel}
        </span>
        <HelpTooltip text={judgeHelp} />
      </div>
    {/if}
  </div>
{/if}
