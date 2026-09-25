<script lang="ts">
  import type { CaseResult } from "@nojv/core";
  import {
    formatVerdictLabel,
    verdictBadgeVariant,
    type VerdictBadgeVariant,
  } from "$lib/utils/verdict-style";

  interface Props {
    cases: CaseResult[];
  }

  let { cases }: Props = $props();

  function formatMemory(kb: number): string {
    if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
    return `${String(kb)} KB`;
  }

  const CASE_PILL_CLASS: Record<VerdictBadgeVariant, string> = {
    "verdict-ac": "border-success/40 bg-success/10 text-success",
    "verdict-wa": "border-destructive/40 bg-destructive/10 text-destructive",
    "verdict-tle": "border-warning/40 bg-warning/10 text-warning",
    "verdict-mle": "border-verdict-purple/40 bg-verdict-purple/10 text-verdict-purple",
    "verdict-re": "border-verdict-orange/40 bg-verdict-orange/10 text-verdict-orange",
    "verdict-ce": "border-info/40 bg-info/10 text-info",
    "verdict-se": "border-muted-foreground/30 bg-muted text-muted-foreground",
    "verdict-pending": "border-verdict-cyan/40 bg-verdict-cyan/10 text-verdict-cyan",
    muted: "border-border bg-muted text-muted-foreground",
  };

  function casePillClass(verdict: string): string {
    return CASE_PILL_CLASS[verdictBadgeVariant(verdict)];
  }
</script>

<div class="flex flex-wrap gap-1.5">
  {#each cases as cr, idx (`cr-${idx}`)}
    <span
      class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-caption font-medium tabular-nums {casePillClass(
        cr.verdict,
      )}"
      title={formatVerdictLabel(cr.verdict)}
    >
      #{cr.index + 1}
      <span class="font-semibold uppercase">{cr.verdict}</span>
      <span class="text-muted-foreground">·</span>
      {cr.timeMs}ms
      {#if cr.memoryKb && cr.memoryKb > 0}
        <span class="text-muted-foreground">·</span>
        {formatMemory(cr.memoryKb)}
      {/if}
    </span>
  {/each}
</div>
