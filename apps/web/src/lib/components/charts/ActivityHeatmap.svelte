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

  const INTENSITY = {
    zero: "bg-[color:var(--muted)]/40",
    low: "bg-[color:color-mix(in_oklch,var(--chart-5)_30%,transparent)]",
    mid: "bg-[color:color-mix(in_oklch,var(--chart-5)_60%,transparent)]",
    high: "bg-[color:var(--chart-5)]"
  } as const;

  function intensityClass(acCount: number): string {
    if (acCount <= 0) return INTENSITY.zero;
    if (acCount === 1) return INTENSITY.low;
    if (acCount <= 3) return INTENSITY.mid;
    return INTENSITY.high;
  }

  function formatLabel(day: HeatmapDay): string {
    return `${day.date} — ${day.acCount} AC / ${day.submissionCount} submissions`;
  }

  const totalAc = $derived(data.reduce((sum, d) => sum + d.acCount, 0));
  const activeDays = $derived(data.filter((d) => d.acCount > 0).length);
  const totalAcLabel = $derived(`${totalAc} AC over ${activeDays} active days`);
</script>

<div
  class="grid grid-cols-[repeat(30,minmax(0,1fr))] gap-1 {className}"
  role="img"
  aria-label={`30-day activity heatmap: ${totalAcLabel}`}
>
  {#each data as day (day.date)}
    <!-- TODO: replace `title` with a shared Tooltip wrapper when $lib/components/ui/tooltip lands -->
    <div
      class="h-4 w-full rounded-[3px] transition-colors duration-fast sm:h-5 {intensityClass(
        day.acCount
      )}"
      aria-hidden="true"
      title={formatLabel(day)}
    ></div>
  {/each}
</div>
