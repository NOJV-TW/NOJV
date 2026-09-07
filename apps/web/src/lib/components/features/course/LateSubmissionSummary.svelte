<script lang="ts">
  import type { LatePenaltyRule } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { formatDateTimeCompact } from "$lib/utils/datetime";

  let {
    dueAt,
    finalAt,
    latePenalty,
  }: {
    dueAt: string | null;
    finalAt: string | null;
    latePenalty: LatePenaltyRule | null;
  } = $props();
  const deadline = $derived(dueAt ?? finalAt);
  const allowsLate = $derived(!!dueAt && !!finalAt && new Date(finalAt) > new Date(dueAt));
</script>

{#if deadline}
  <section class="space-y-2 text-body-sm" aria-label={m.assignmentCreate_latePenaltyLabel()}>
    <dl class="flex flex-wrap gap-x-8 gap-y-2">
      <div>
        <dt class="text-caption text-muted-foreground">{m.lateSubmission_dueLabel()}</dt>
        <dd>{formatDateTimeCompact(deadline)}</dd>
      </div>
      {#if allowsLate && finalAt}<div>
          <dt class="text-caption text-muted-foreground">{m.lateSubmission_finalLabel()}</dt>
          <dd>{formatDateTimeCompact(finalAt)}</dd>
        </div>{/if}
    </dl>
    <p>
      {#if !allowsLate}{m.lateSubmission_noLate()}
      {:else if latePenalty?.type === "flat_late_penalty"}{m.lateSubmission_flatSummary({
          pct: latePenalty.penaltyPct,
        })}
      {:else if latePenalty?.type === "daily_late_penalty"}{m.lateSubmission_dailySummary({
          pct: latePenalty.perDayPct,
        })}
      {:else}{m.lateSubmission_noPenalty()}{/if}
    </p>
    {#if allowsLate && latePenalty}<p class="text-caption text-muted-foreground">
        {m.lateSubmission_bestScoreHint()}
      </p>{/if}
  </section>
{/if}
