<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import HelpTooltip from "$lib/components/ui/HelpTooltip.svelte";

  interface Props {
    judgeType: string;
    submissionType: string;
    mode: string;
    /** Compact variant (no wrapper, no help tooltips) used in list cards. */
    compact?: boolean;
  }

  let { judgeType, submissionType, mode, compact = false }: Props = $props();

  const judgeTypeLabel: Record<string, () => string> = {
    standard: () => m.problemDetail_standardBadge(),
    checker: () => m.problemDetail_checkerBadge(),
    interactive: () => m.problemDetail_interactiveBadge()
  };

  const judgeTypeHelp: Record<string, () => string> = {
    standard: () => m.problemDetail_standardHelp(),
    checker: () => m.problemDetail_checkerHelp(),
    interactive: () => m.problemDetail_interactiveHelp()
  };

  const judgeTypeColor: Record<string, string> = {
    standard: "bg-muted text-muted-foreground",
    checker: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    interactive: "bg-sky-500/15 text-sky-700 dark:text-sky-400"
  };

  const submissionTypeLabel: Record<string, () => string> = {
    full_source: () => m.problemDetail_fullSourceBadge(),
    function: () => m.problemDetail_functionBadge(),
    zip_project: () => m.problemDetail_multiFileBadge()
  };

  const submissionTypeHelp: Record<string, () => string> = {
    full_source: () => m.problemDetail_fullSourceHelp(),
    function: () => m.problemDetail_functionHelp(),
    zip_project: () => m.problemDetail_multiFileHelp()
  };

  let judgeLabel = $derived(
    (judgeTypeLabel[judgeType] ?? judgeTypeLabel["standard"]!)()
  );
  let judgeHelp = $derived(
    (judgeTypeHelp[judgeType] ?? judgeTypeHelp["standard"]!)()
  );
  let judgeColor = $derived(
    judgeTypeColor[judgeType] ?? judgeTypeColor["standard"]!
  );
  let submissionLabel = $derived(
    (submissionTypeLabel[submissionType] ?? submissionTypeLabel["full_source"]!)()
  );
  let submissionHelp = $derived(
    (submissionTypeHelp[submissionType] ?? submissionTypeHelp["full_source"]!)()
  );
</script>

{#if compact}
  <span class="inline-flex flex-wrap items-center gap-1">
    <span class="rounded-full px-2 py-0.5 text-[10px] font-medium {judgeColor}">
      {judgeLabel}
    </span>
    <span class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      {submissionLabel}
    </span>
    {#if mode === "advanced"}
      <span class="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-400">
        {m.problemDetail_advancedModeBadge()}
      </span>
    {/if}
  </span>
{:else}
  <div
    class="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2"
  >
    <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {m.problemDetail_specialLabelsTitle()}
    </span>
    <span class="inline-flex items-center gap-1">
      <span class="rounded-full px-2.5 py-0.5 text-xs font-medium {judgeColor}">
        {judgeLabel}
      </span>
      <HelpTooltip text={judgeHelp} />
    </span>
    <span class="inline-flex items-center gap-1">
      <span class="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
        {submissionLabel}
      </span>
      <HelpTooltip text={submissionHelp} />
    </span>
    {#if mode === "advanced"}
      <span class="inline-flex items-center gap-1">
        <span class="rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-400">
          {m.problemDetail_advancedModeBadge()}
        </span>
        <HelpTooltip text={m.problemDetail_advancedModeHelp()} />
      </span>
    {/if}
  </div>
{/if}
