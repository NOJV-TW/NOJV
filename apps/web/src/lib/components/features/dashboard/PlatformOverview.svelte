<script lang="ts">
  import type { platformDomain } from "@nojv/application";
  import { m } from "$lib/paraglide/messages.js";
  import {
    BarChart3,
    CheckCircle2,
    FileCode2,
    LineChart,
    PieChart,
    Users,
  } from "@lucide/svelte";
  import EChart from "$lib/components/primitives/charts/EChart.svelte";
  import StatCard from "$lib/components/primitives/ui/StatCard.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import { formatVerdictLabel } from "$lib/utils/verdict-style";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
  import type { EChartsOption } from "echarts";

  interface ThemeColors {
    success: string;
    warning: string;
    destructive: string;
    info: string;
    verdictOrange: string;
    verdictPurple: string;
    verdictCyan: string;
    chart1: string;
    chart2: string;
    chart3: string;
    chart4: string;
    chart5: string;
    mutedFg: string;
    foreground: string;
    panel: string;
  }

  interface Props {
    overview: platformDomain.PlatformOverview;
    themeColors: ThemeColors;
  }

  let { overview, themeColors }: Props = $props();

  const hasSubmissions = $derived(overview.totals.submissions30d > 0);

  const verdictPalette = $derived<Record<string, string>>({
    accepted: themeColors.success,
    wrong_answer: themeColors.destructive,
    runtime_error: themeColors.verdictOrange,
    time_limit_exceeded: themeColors.warning,
    memory_limit_exceeded: themeColors.verdictPurple,
    compile_error: themeColors.info,
    system_error: themeColors.mutedFg,
    queued: themeColors.verdictCyan,
    compiling: themeColors.verdictCyan,
    running: themeColors.verdictCyan,
  });

  const languagePalette = $derived([
    themeColors.chart1,
    themeColors.chart2,
    themeColors.chart3,
    themeColors.chart4,
    themeColors.chart5,
  ]);

  const trendOption: EChartsOption = $derived({
    animation: false,
    tooltip: {
      trigger: "axis",
      appendToBody: true,
      extraCssText: "pointer-events:none;",
      transitionDuration: 0,
    },
    legend: { bottom: 0, textStyle: { fontSize: 11, color: themeColors.foreground } },
    grid: { left: 44, right: 44, top: 12, bottom: 40 },
    xAxis: {
      type: "category",
      data: overview.daily.map((d) => d.label),
      axisLabel: { fontSize: 11, color: themeColors.mutedFg, interval: 4 },
    },
    yAxis: [
      {
        type: "value",
        minInterval: 1,
        axisLabel: { fontSize: 11, color: themeColors.mutedFg },
      },
      {
        type: "value",
        minInterval: 1,
        axisLabel: { fontSize: 11, color: themeColors.mutedFg },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: m.dashboard_platformTrendSubmissions(),
        type: "bar",
        data: overview.daily.map((d) => d.total),
        itemStyle: { color: themeColors.chart1, borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 14,
      },
      {
        name: m.dashboard_platformTrendAccepted(),
        type: "line",
        smooth: true,
        symbol: "none",
        data: overview.daily.map((d) => d.accepted),
        lineStyle: { color: themeColors.success, width: 2 },
        itemStyle: { color: themeColors.success },
        areaStyle: { color: themeColors.success, opacity: 0.12 },
      },
      {
        name: m.dashboard_platformTrendActiveUsers(),
        type: "line",
        yAxisIndex: 1,
        symbol: "none",
        data: overview.daily.map((d) => d.activeUsers),
        lineStyle: { color: themeColors.info, width: 2, type: "dashed" },
        itemStyle: { color: themeColors.info },
      },
    ],
  });

  const verdictOption: EChartsOption = $derived({
    animation: false,
    tooltip: {
      trigger: "item",
      formatter: "{b}: {c} ({d}%)",
      appendToBody: true,
      extraCssText: "pointer-events:none;",
      transitionDuration: 0,
    },
    legend: {
      bottom: 0,
      textStyle: { fontSize: 11, color: themeColors.foreground },
      type: "scroll",
    },
    series: [
      {
        type: "pie",
        radius: ["55%", "75%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        emphasis: { disabled: true },
        itemStyle: {
          borderRadius: 6,
          borderColor: themeColors.panel,
          borderWidth: 2,
        },
        label: { show: false },
        data: overview.byVerdict.map((v) => ({
          name: formatVerdictLabel(v.status),
          value: v.count,
          itemStyle: {
            color: verdictPalette[v.status] ?? themeColors.mutedFg,
            borderWidth: v.status === "accepted" ? 3 : 2,
            opacity: v.status === "accepted" ? 1 : 0.5,
          },
        })),
      },
    ],
  });

  const languageOption: EChartsOption = $derived({
    animation: false,
    tooltip: {
      trigger: "item",
      formatter: "{b}: {c} ({d}%)",
      appendToBody: true,
      extraCssText: "pointer-events:none;",
      transitionDuration: 0,
    },
    legend: {
      bottom: 0,
      textStyle: { fontSize: 11, color: themeColors.foreground },
      type: "scroll",
    },
    series: [
      {
        type: "pie",
        radius: ["40%", "70%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        emphasis: { disabled: true },
        itemStyle: {
          borderRadius: 6,
          borderColor: themeColors.panel,
          borderWidth: 2,
        },
        label: { show: false },
        data: overview.byLanguage.map((l, i) => ({
          name: l.language,
          value: l.count,
          itemStyle: {
            color: languagePalette[i % languagePalette.length] ?? themeColors.mutedFg,
          },
        })),
      },
    ],
  });

  function acRateOf(problem: { attempts: number; accepted: number }): number {
    return problem.attempts > 0 ? Math.round((problem.accepted / problem.attempts) * 100) : 0;
  }
</script>

<div class="space-y-6">
  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <StatCard label={m.dashboard_platformUsers()} value={overview.totals.users} icon={Users} />
    <StatCard
      label={m.dashboard_platformProblems()}
      value={overview.totals.publicProblems}
      icon={FileCode2}
    />
    <StatCard
      label={m.dashboard_platformSubmissions30d()}
      value={overview.totals.submissions30d}
      icon={BarChart3}
    />
    <StatCard
      label={m.dashboard_platformAcRate30d()}
      value={`${overview.totals.acRate30d}%`}
      icon={CheckCircle2}
    />
  </div>

  <Card variant="surface" size="lg">
    <div class="mb-4 flex items-baseline justify-between gap-4">
      <h2 class="text-title-sm font-semibold">{m.dashboard_platformTrend()}</h2>
      <span class="text-caption text-muted-foreground">{m.dashboard_last30Days()}</span>
    </div>
    {#if hasSubmissions}
      <EChart
        option={trendOption}
        ariaLabel={m.dashboard_platformTrend()}
        class="h-72 w-full"
      />
    {:else}
      <EmptyState variant="minimal" icon={LineChart} title={m.dashboard_noActivity()} />
    {/if}
  </Card>

  <div class="grid gap-4 md:grid-cols-2">
    <Card variant="surface" size="lg">
      <div class="mb-4 flex items-baseline justify-between gap-4">
        <h2 class="text-title-sm font-semibold">{m.dashboard_verdictDistribution()}</h2>
        <span class="text-caption text-muted-foreground">{m.dashboard_last30Days()}</span>
      </div>
      {#if overview.byVerdict.length > 0}
        <div class="relative">
          <EChart
            option={verdictOption}
            ariaLabel={m.dashboard_verdictDistribution()}
            class="h-56 w-full"
          />
          <div
            class="pointer-events-none absolute inset-x-0 top-[45%] flex -translate-y-1/2 flex-col items-center"
          >
            <span class="text-headline font-semibold leading-none tabular-nums">
              {overview.totals.acRate30d}%
            </span>
            <span class="mt-1 text-caption text-muted-foreground">
              {m.dashboard_acRate()}
            </span>
          </div>
        </div>
      {:else}
        <EmptyState variant="minimal" icon={PieChart} title={m.dashboard_noActivity()} />
      {/if}
    </Card>

    <Card variant="surface" size="lg">
      <div class="mb-4 flex items-baseline justify-between gap-4">
        <h2 class="text-title-sm font-semibold">{m.dashboard_languageDist()}</h2>
        <span class="text-caption text-muted-foreground">{m.dashboard_last30Days()}</span>
      </div>
      {#if overview.byLanguage.length > 0}
        <EChart
          option={languageOption}
          ariaLabel={m.dashboard_languageDist()}
          class="h-56 w-full"
        />
      {:else}
        <EmptyState variant="minimal" icon={PieChart} title={m.dashboard_noActivity()} />
      {/if}
    </Card>
  </div>

  <Card variant="surface" size="lg">
    <div class="mb-4 flex items-baseline justify-between gap-4">
      <h2 class="text-title-sm font-semibold">{m.dashboard_platformHotProblems()}</h2>
      <span class="text-caption text-muted-foreground">{m.dashboard_last30Days()}</span>
    </div>
    {#if overview.hotProblems.length > 0}
      <table class="w-full table-fixed text-body-sm">
        <thead>
          <tr class="text-left text-caption text-muted-foreground">
            <th class="pb-2 font-medium">{m.dashboard_platformColProblem()}</th>
            <th class="w-20 pb-2 text-right font-medium sm:w-24">
              {m.dashboard_platformColAttempts()}
            </th>
            <th class="hidden w-24 pb-2 text-right font-medium sm:table-cell">
              {m.dashboard_platformColAccepted()}
            </th>
            <th class="w-20 pb-2 text-right font-medium sm:w-24">
              {m.dashboard_platformColAcRate()}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border-subtle">
          {#each overview.hotProblems as problem (problem.id)}
            <tr class="transition-colors hover:bg-muted/30">
              <td class="py-3 pr-4">
                <a
                  href="/problems/{problem.id}"
                  class="block truncate font-medium hover:underline"
                >
                  {formatProblemDisplayName(problem)}
                </a>
              </td>
              <td class="py-3 text-right tabular-nums">{problem.attempts}</td>
              <td class="hidden py-3 text-right tabular-nums sm:table-cell">
                {problem.accepted}
              </td>
              <td class="py-3 text-right tabular-nums text-muted-foreground">
                {acRateOf(problem)}%
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <EmptyState variant="minimal" icon={FileCode2} title={m.dashboard_noActivity()} />
    {/if}
  </Card>
</div>
