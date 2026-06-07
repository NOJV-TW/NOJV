<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { getLocale } from "$lib/paraglide/runtime.js";

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
    high: "bg-[color:var(--chart-5)]",
  } as const;

  function intensityClass(acCount: number): string {
    if (acCount <= 0) return INTENSITY.zero;
    if (acCount === 1) return INTENSITY.low;
    if (acCount <= 3) return INTENSITY.mid;
    return INTENSITY.high;
  }

  function formatLabel(day: HeatmapDay): string {
    return m.dashboard_heatmapDayTooltip({
      date: day.date,
      ac: day.acCount,
      submissions: day.submissionCount,
    });
  }

  type Cell = HeatmapDay | null;
  const cells = $derived.by<Cell[]>(() => {
    if (data.length === 0) return [];
    const first = new Date(`${data[0]!.date}T00:00:00Z`);
    const leading = first.getUTCDay();
    return [...Array.from<Cell>({ length: leading }).fill(null), ...data];
  });
  const columnCount = $derived(Math.ceil(cells.length / 7));

  const weekdayLabels = $derived.by(() => {
    const fmt = new Intl.DateTimeFormat(getLocale(), { weekday: "short", timeZone: "UTC" });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 7 + i))));
  });

  const totalAc = $derived(data.reduce((sum, d) => sum + d.acCount, 0));
  const activeDays = $derived(data.filter((d) => d.acCount > 0).length);
  const totalAcLabel = $derived(m.dashboard_heatmapSummary({ ac: totalAc, days: activeDays }));
</script>

<div
  class="flex gap-2 {className}"
  role="img"
  aria-label={`${m.dashboard_heatmapAria()}: ${totalAcLabel}`}
>
  <div class="flex flex-col justify-between py-0.5 text-micro text-muted-foreground">
    {#each weekdayLabels as label, i (i)}
      {#if i % 2 === 1}
        <span class="leading-none">{label}</span>
      {:else}
        <span class="leading-none">&nbsp;</span>
      {/if}
    {/each}
  </div>
  <div
    class="grid flex-1 grid-flow-col gap-1"
    style="grid-template-rows: repeat(7, minmax(0, 1fr)); grid-template-columns: repeat({columnCount}, minmax(0, 1fr));"
  >
    {#each cells as cell, i (i)}
      {#if cell === null}
        <div class="h-4 w-full sm:h-5" aria-hidden="true"></div>
      {:else}
        <div
          class="h-4 w-full rounded-[3px] transition-colors duration-fast sm:h-5 {intensityClass(
            cell.acCount,
          )}"
          aria-hidden="true"
          title={formatLabel(cell)}
        ></div>
      {/if}
    {/each}
  </div>
</div>
