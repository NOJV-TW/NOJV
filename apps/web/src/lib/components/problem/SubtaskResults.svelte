<script lang="ts">
  import type { SubtaskResultItem } from "@nojv/core";

  interface Props {
    subtaskResults: SubtaskResultItem[];
    totalScore: number;
  }

  let { subtaskResults, totalScore }: Props = $props();

  let expanded = $state<Record<number, boolean>>({});

  const maxScore = $derived(subtaskResults.reduce((sum, s) => sum + s.weight, 0) || 100);

  const verdictBadgeColor: Record<string, string> = {
    AC: "bg-emerald-50 text-emerald-700",
    WA: "bg-red-50 text-red-700",
    TLE: "bg-amber-50 text-amber-700",
    MLE: "bg-orange-50 text-orange-700",
    RE: "bg-purple-50 text-purple-700",
    CE: "bg-stone-100 text-stone-600"
  };

  function badgeColor(verdict: string): string {
    return verdictBadgeColor[verdict] ?? "bg-stone-100 text-stone-600";
  }

  function formatMemory(kb: number): string {
    if (kb >= 1024) {
      return `${(kb / 1024).toFixed(1)}MB`;
    }
    return `${String(kb)}KB`;
  }
</script>

<div class="space-y-3">
  <div class="flex items-baseline gap-2">
    <span class="text-sm font-semibold text-stone-700">Score:</span>
    <span
      class="text-lg font-bold tabular-nums {totalScore === maxScore
        ? 'text-emerald-600'
        : totalScore > 0
          ? 'text-amber-600'
          : 'text-red-600'}"
    >
      {totalScore}/{maxScore}
    </span>
  </div>

  {#each subtaskResults as subtask, index (`subtask-${subtask.testcaseSetId}`)}
    {@const isExpanded = expanded[index] ?? true}
    <div
      class="rounded-lg border {subtask.passed
        ? 'border-emerald-200 bg-emerald-50/30'
        : 'border-red-200 bg-red-50/30'}"
    >
      <button
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
        onclick={() => (expanded[index] = !isExpanded)}
        type="button"
      >
        <span class="text-xs text-stone-400">{isExpanded ? "\u25BC" : "\u25B6"}</span>
        <span class="font-semibold {subtask.passed ? 'text-emerald-700' : 'text-red-700'}">
          {subtask.label}
        </span>
        <span class="text-xs text-stone-500">({subtask.weight} pts)</span>
        <span
          class="ml-auto rounded-full px-2 py-0.5 text-xs font-medium {subtask.passed
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-red-100 text-red-700'}"
        >
          {subtask.passed ? "PASSED" : "FAILED"}
        </span>
      </button>

      {#if isExpanded && subtask.cases.length > 0}
        <div class="border-t {subtask.passed ? 'border-emerald-200' : 'border-red-200'} px-3 py-2">
          <div class="space-y-1">
            {#each subtask.cases as caseResult, ci (`case-${caseResult.testcaseId}`)}
              {@const isLast = ci === subtask.cases.length - 1}
              <div class="flex items-center gap-2 text-xs">
                <span class="text-stone-400">{isLast ? "\u2514" : "\u251C"}\u2500</span>
                <span class="text-stone-500">Case {caseResult.ordinal}</span>
                <span
                  class="rounded px-1.5 py-0.5 font-medium {badgeColor(caseResult.verdict)}"
                >
                  {caseResult.verdict}
                </span>
                <span class="tabular-nums text-stone-400">
                  {String(caseResult.runtimeMs)}ms
                </span>
                {#if caseResult.memoryKb != null}
                  <span class="tabular-nums text-stone-400">
                    {formatMemory(caseResult.memoryKb)}
                  </span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/each}
</div>
