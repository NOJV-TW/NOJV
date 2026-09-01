<script lang="ts">
  import { CalendarCheck2, CalendarClock, Radio } from "@lucide/svelte";
  import { assessmentGroupIcon, type AssessmentGroupStatus } from "$lib/utils/assessment-group";

  interface Props {
    label: string;
    status: AssessmentGroupStatus;
    count?: number;
  }

  let { label, status, count }: Props = $props();

  const icon = $derived(assessmentGroupIcon(status));
</script>

<div class="mb-4 flex items-end gap-3">
  <span class="inline-flex items-center gap-2 text-body font-semibold">
    {#if icon === "active"}
      <Radio class="size-4 text-primary" aria-hidden="true" />
    {:else if icon === "ended"}
      <CalendarCheck2 class="size-4 text-muted-foreground" aria-hidden="true" />
    {:else}
      <CalendarClock class="size-4 text-primary" aria-hidden="true" />
    {/if}
    <span>{label}</span>
  </span>
  {#if count !== undefined}
    <span class="text-caption text-muted-foreground tabular-nums">{count}</span>
  {/if}
  <div class="ml-1 flex-1 border-t border-border-subtle"></div>
</div>
