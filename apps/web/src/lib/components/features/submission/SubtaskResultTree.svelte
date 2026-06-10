<script lang="ts">
  import type { SubtaskResultItem } from "@nojv/core";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { verdictBadgeVariant } from "$lib/utils/verdict-style";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    subtaskResults: SubtaskResultItem[];
  }

  let { subtaskResults }: Props = $props();

  let expanded = $state<Record<number, boolean>>({});

  function earnedOf(s: SubtaskResultItem): number {
    return Math.round(s.rawScore ?? (s.passed ? s.weight : 0));
  }

  type SubtaskState = "full" | "partial" | "zero";
  function stateOf(s: SubtaskResultItem): SubtaskState {
    const earned = earnedOf(s);
    if (earned >= s.weight) return "full";
    return earned > 0 ? "partial" : "zero";
  }

  const totalWeight = $derived(subtaskResults.reduce((sum, s) => sum + s.weight, 0));
  const earnedWeight = $derived(subtaskResults.reduce((sum, s) => sum + earnedOf(s), 0));

  function formatMemory(kb: number): string {
    if (kb >= 1024) {
      return `${(kb / 1024).toFixed(1)}MB`;
    }
    return `${String(kb)}KB`;
  }
</script>

<div class="space-y-3">
  <div class="flex items-baseline gap-2">
    <span class="text-body-sm font-semibold text-foreground">{m.subtask_score()}</span>
    <span
      class="text-body-lg font-bold tabular-nums {earnedWeight === totalWeight
        ? 'text-success'
        : earnedWeight > 0
          ? 'text-warning'
          : 'text-destructive'}"
    >
      {earnedWeight}/{totalWeight}
    </span>
  </div>

  {#each subtaskResults as subtask, index (`subtask-${subtask.testcaseSetId}`)}
    {@const isExpanded = expanded[index] ?? true}
    {@const state = stateOf(subtask)}
    {@const earned = earnedOf(subtask)}
    <div
      class="rounded-md border {state === 'full'
        ? 'border-success/30 bg-success/5'
        : state === 'partial'
          ? 'border-warning/30 bg-warning/5'
          : 'border-destructive/30 bg-destructive/5'}"
    >
      <button
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-body-sm"
        onclick={() => (expanded[index] = !isExpanded)}
        type="button"
      >
        <span class="text-caption text-muted-foreground">{isExpanded ? "▼" : "▶"}</span>
        <span
          class="font-semibold {state === 'full'
            ? 'text-success'
            : state === 'partial'
              ? 'text-warning'
              : 'text-destructive'}"
        >
          {subtask.label}
        </span>
        <span class="text-caption text-muted-foreground tabular-nums"
          >({earned}/{subtask.weight} pts)</span
        >
        <span
          class="ml-auto rounded-full px-2 py-0.5 text-caption font-medium {state === 'full'
            ? 'bg-success/15 text-success'
            : state === 'partial'
              ? 'bg-warning/15 text-warning'
              : 'bg-destructive/15 text-destructive'}"
        >
          {state === "full"
            ? m.subtask_passed()
            : state === "partial"
              ? m.subtask_partial()
              : m.subtask_failed()}
        </span>
      </button>

      {#if isExpanded && subtask.cases.length > 0}
        <div
          class="border-t {state === 'full'
            ? 'border-success/30'
            : state === 'partial'
              ? 'border-warning/30'
              : 'border-destructive/30'} px-3 py-2"
        >
          <div class="space-y-1">
            {#each subtask.cases as caseResult, ci (`case-${ci}-${caseResult.testcaseId ?? caseResult.index}`)}
              {@const isLast = ci === subtask.cases.length - 1}
              <div class="flex items-center gap-2 text-caption">
                <span class="text-muted-foreground">{isLast ? "└─" : "├─"}</span>
                <span class="w-12 tabular-nums text-muted-foreground"
                  >{m.subtask_caseLabel({ ordinal: caseResult.index })}</span
                >
                <Badge variant={verdictBadgeVariant(caseResult.verdict)} size="xs"
                  >{caseResult.verdict}</Badge
                >
                <span class="tabular-nums text-muted-foreground">
                  {String(caseResult.timeMs)}ms
                </span>
                {#if caseResult.memoryKb != null}
                  <span class="tabular-nums text-muted-foreground">
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
