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

  const totalWeight = $derived(subtaskResults.reduce((sum, s) => sum + s.weight, 0));
  const passedWeight = $derived(
    subtaskResults.reduce((sum, s) => sum + (s.passed ? s.weight : 0), 0),
  );

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
      class="text-body-lg font-bold tabular-nums {passedWeight === totalWeight
        ? 'text-success'
        : passedWeight > 0
          ? 'text-warning'
          : 'text-destructive'}"
    >
      {passedWeight}/{totalWeight}
    </span>
  </div>

  {#each subtaskResults as subtask, index (`subtask-${subtask.testcaseSetId}`)}
    {@const isExpanded = expanded[index] ?? true}
    <div
      class="rounded-md border {subtask.passed
        ? 'border-success/30 bg-success/5'
        : 'border-destructive/30 bg-destructive/5'}"
    >
      <button
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-body-sm"
        onclick={() => (expanded[index] = !isExpanded)}
        type="button"
      >
        <span class="text-caption text-muted-foreground">{isExpanded ? "▼" : "▶"}</span>
        <span class="font-semibold {subtask.passed ? 'text-success' : 'text-destructive'}">
          {subtask.label}
        </span>
        <span class="text-caption text-muted-foreground tabular-nums"
          >({subtask.weight} pts)</span
        >
        <span
          class="ml-auto rounded-full px-2 py-0.5 text-caption font-medium {subtask.passed
            ? 'bg-success/15 text-success'
            : 'bg-destructive/15 text-destructive'}"
        >
          {subtask.passed ? m.subtask_passed() : m.subtask_failed()}
        </span>
      </button>

      {#if isExpanded && subtask.cases.length > 0}
        <div
          class="border-t {subtask.passed
            ? 'border-success/30'
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
