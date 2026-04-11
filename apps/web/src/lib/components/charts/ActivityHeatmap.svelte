<script lang="ts">
  interface HeatmapDay {
    date: string;
    acCount: number;
    submissionCount: number;
  }

  interface Props {
    data: HeatmapDay[];
    class?: string;
  }

  let { data, class: className = "" }: Props = $props();

  function intensityClass(acCount: number): string {
    if (acCount <= 0) return "bg-[color:var(--muted)]/40";
    if (acCount === 1)
      return "bg-[color:color-mix(in_oklch,var(--chart-5)_30%,transparent)]";
    if (acCount <= 3)
      return "bg-[color:color-mix(in_oklch,var(--chart-5)_60%,transparent)]";
    return "bg-[color:var(--chart-5)]";
  }

  function formatLabel(day: HeatmapDay): string {
    return `${day.date} — ${day.acCount} AC / ${day.submissionCount} submissions`;
  }
</script>

<div
  class="grid grid-cols-[repeat(30,minmax(0,1fr))] gap-1 {className}"
  role="group"
  aria-label="30-day activity heatmap"
>
  {#each data as day (day.date)}
    <div
      class="h-4 w-full rounded-[3px] transition-colors duration-fast sm:h-5 {intensityClass(
        day.acCount
      )}"
      role="img"
      aria-label={formatLabel(day)}
      title={formatLabel(day)}
    ></div>
  {/each}
</div>
