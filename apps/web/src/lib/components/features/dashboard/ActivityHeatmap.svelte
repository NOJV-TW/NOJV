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
    title: string;
    class?: string;
  }

  let { data, title, class: className = "" }: Props = $props();

  const INTENSITY = {
    zero: "bg-[color:var(--muted)]/40",
    low: "bg-[color:color-mix(in_oklch,var(--success)_25%,transparent)]",
    mid: "bg-[color:color-mix(in_oklch,var(--success)_55%,transparent)]",
    high: "bg-[color:var(--success)]",
  } as const;

  function intensityClass(count: number): string {
    if (count <= 0) return INTENSITY.zero;
    if (count === 1) return INTENSITY.low;
    if (count <= 3) return INTENSITY.mid;
    return INTENSITY.high;
  }

  type Metric = "ac" | "submissions";
  let metric = $state<Metric>("ac");
  const countOf = (day: HeatmapDay) => (metric === "ac" ? day.acCount : day.submissionCount);

  const dateFmt = $derived(
    new Intl.DateTimeFormat(getLocale(), {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
  );
  const formatDate = (date: string) => dateFmt.format(new Date(`${date}T00:00:00Z`));

  // A single shared tooltip (GitHub-style) follows the hovered cell — far cheaper
  // than wrapping all ~365 cells in their own tooltip component.
  let tip = $state<{ day: HeatmapDay; left: number; y: number; above: boolean } | null>(null);

  function showTip(day: HeatmapDay, event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const above = rect.top > 48; // flip below the cell when there's no room above
    tip = {
      day,
      left: rect.left + rect.width / 2,
      y: above ? rect.top - 8 : rect.bottom + 8,
      above,
    };
  }

  function hideTip() {
    tip = null;
  }

  // Move the tooltip to <body> so a transformed/overflow-hidden ancestor (the
  // dashboard's fade-up animation) can't reposition or clip a `fixed` element.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
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

<div class={className}>
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h2 class="text-title-sm font-semibold">{title}</h2>
    <div class="flex items-center gap-3">
      <div
        class="hidden items-center gap-1 text-micro text-muted-foreground sm:flex"
        aria-hidden="true"
      >
        <span>{m.dashboard_heatmapLegendLess()}</span>
        <span class="size-3 rounded-[3px] {INTENSITY.zero}"></span>
        <span class="size-3 rounded-[3px] {INTENSITY.low}"></span>
        <span class="size-3 rounded-[3px] {INTENSITY.mid}"></span>
        <span class="size-3 rounded-[3px] {INTENSITY.high}"></span>
        <span>{m.dashboard_heatmapLegendMore()}</span>
      </div>
      <div
        class="inline-flex shrink-0 rounded-full border border-border bg-[color:var(--color-panel)] p-0.5 text-micro font-medium"
      >
        <button
          type="button"
          class="rounded-full px-2.5 py-1 transition-colors {metric === 'ac'
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:text-foreground'}"
          aria-pressed={metric === "ac"}
          onclick={() => (metric = "ac")}
        >
          {m.dashboard_heatmapToggleAc()}
        </button>
        <button
          type="button"
          class="rounded-full px-2.5 py-1 transition-colors {metric === 'submissions'
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:text-foreground'}"
          aria-pressed={metric === "submissions"}
          onclick={() => (metric = "submissions")}
        >
          {m.dashboard_heatmapToggleSub()}
        </button>
      </div>
    </div>
  </div>
  <div
    class="flex gap-2"
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
            class="h-4 w-full rounded-[3px] transition-colors duration-fast hover:ring-1 hover:ring-foreground/40 sm:h-5 {intensityClass(
              countOf(cell),
            )}"
            aria-hidden="true"
            onmouseenter={(event) => showTip(cell, event)}
            onmouseleave={hideTip}
          ></div>
        {/if}
      {/each}
    </div>
  </div>
</div>

{#if tip}
  <div
    use:portal
    class="pointer-events-none fixed z-[100] -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-3 py-2 shadow-md {tip.above
      ? '-translate-y-full'
      : ''}"
    style="left: {tip.left}px; top: {tip.y}px;"
    role="status"
  >
    <div class="text-body font-semibold leading-tight text-popover-foreground">
      {metric === "ac"
        ? m.dashboard_heatmapTipAc({ ac: tip.day.acCount })
        : m.dashboard_heatmapTipSub({ submissions: tip.day.submissionCount })}
    </div>
    <div class="mt-0.5 text-micro text-muted-foreground">
      {formatDate(tip.day.date)}
    </div>
  </div>
{/if}
