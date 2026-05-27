<script lang="ts">
  import type { CaseResult } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    cases: CaseResult[];
    /** When true, cases with stdout expand to reveal stdout (+ stderr). */
    allowExpand?: boolean;
  }

  let { cases, allowExpand = false }: Props = $props();

  let expandedIndex = $state<number | null>(null);
  const expandedCase = $derived(expandedIndex !== null ? cases[expandedIndex] : null);

  function formatMemory(kb: number): string {
    if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
    return `${String(kb)} KB`;
  }

  function casePillClass(passed: boolean): string {
    return passed
      ? "border-success/40 bg-success/10 text-success"
      : "border-destructive/40 bg-destructive/10 text-destructive";
  }
</script>

<div class="flex flex-wrap gap-1.5">
  {#each cases as cr, idx (`cr-${idx}`)}
    {@const cls = casePillClass(cr.verdict === "AC")}
    {@const interactive = allowExpand && (cr.stdout?.length ?? 0) > 0}
    {#if interactive}
      <button
        class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-caption font-medium tabular-nums transition-[background-color] duration-fast {cls} {expandedIndex ===
        idx
          ? 'ring-1 ring-foreground/30'
          : 'hover:brightness-110'}"
        onclick={() => (expandedIndex = expandedIndex === idx ? null : idx)}
        type="button"
      >
        #{idx + 1}
        <span class="text-muted-foreground">·</span>
        {cr.timeMs}ms
        {#if cr.memoryKb && cr.memoryKb > 0}
          <span class="text-muted-foreground">·</span>
          {formatMemory(cr.memoryKb)}
        {/if}
      </button>
    {:else}
      <span
        class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-caption font-medium tabular-nums {cls}"
      >
        #{idx + 1}
        <span class="text-muted-foreground">·</span>
        {cr.timeMs}ms
        {#if cr.memoryKb && cr.memoryKb > 0}
          <span class="text-muted-foreground">·</span>
          {formatMemory(cr.memoryKb)}
        {/if}
      </span>
    {/if}
  {/each}
</div>

{#if allowExpand && expandedCase}
  <div class="mt-2 flex flex-col gap-2">
    <div>
      <p class="text-caption font-medium text-muted-foreground">
        {m.submissionDetail_caseStdout()}
      </p>
      <pre
        class="mt-1 max-h-48 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-body-sm text-foreground">{expandedCase.stdout ||
          m.common_emptyOutput()}</pre>
    </div>
    {#if expandedCase.stderr}
      <div>
        <p class="text-caption font-medium text-destructive">
          {m.submissionDetail_stderr()}
        </p>
        <pre
          class="mt-1 max-h-48 overflow-auto rounded-md bg-destructive/10 px-3 py-2 font-mono text-body-sm text-destructive">{expandedCase.stderr}</pre>
      </div>
    {/if}
  </div>
{/if}
