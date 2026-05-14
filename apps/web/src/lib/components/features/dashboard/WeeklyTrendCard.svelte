<script lang="ts">
  import { LineChart } from "@lucide/svelte";
  import type { EChartsOption } from "echarts";
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/primitives/ui/card";
  import EChart from "$lib/components/primitives/charts/EChart.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";

  interface TrendDay {
    date: string;
    submissionCount: number;
    acCount: number;
  }

  interface Props {
    data: TrendDay[];
  }

  let { data }: Props = $props();

  const hasData = $derived(data.some((d) => d.submissionCount > 0));

  // Show MM-DD on the axis — full ISO would clutter a 7-tick chart.
  const labels = $derived(data.map((d) => d.date.slice(5)));

  const option: EChartsOption = $derived({
    grid: { left: 32, right: 16, top: 16, bottom: 28 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { fontSize: 11 },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        type: "line",
        data: data.map((d) => d.submissionCount),
        smooth: true,
        itemStyle: { color: "var(--chart-3)" },
        areaStyle: { opacity: 0.15 },
        symbolSize: 6,
      },
    ],
  });
</script>

<Card variant="surface" size="lg">
  <h2 class="mb-4 text-title-sm font-semibold">
    {m.dashboard_weeklyTrendTitle()}
  </h2>
  {#if hasData}
    <EChart {option} class="h-40 w-full" />
  {:else}
    <EmptyState
      variant="minimal"
      icon={LineChart}
      title={m.dashboard_weeklyTrendNoData()}
    />
  {/if}
</Card>
