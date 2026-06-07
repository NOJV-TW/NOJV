<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { AlertTriangle, Code2, LineChart, PieChart } from "@lucide/svelte";
  import EChart from "$lib/components/primitives/charts/EChart.svelte";
  import ActivityHeatmap from "$lib/components/features/dashboard/ActivityHeatmap.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import VerdictBadge from "$lib/components/primitives/ui/VerdictBadge.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import StreakCard from "$lib/components/features/dashboard/StreakCard.svelte";
  import WeeklyTrendCard from "$lib/components/features/dashboard/WeeklyTrendCard.svelte";
  import SuggestedProblemsCard from "$lib/components/features/dashboard/SuggestedProblemsCard.svelte";
  import WelcomeGuide from "$lib/components/features/dashboard/WelcomeGuide.svelte";
  import { Skeleton } from "$lib/components/primitives/ui/skeleton";
  import { formatVerdictLabel } from "$lib/utils/verdict-style";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
  import { buildActivityModel } from "$lib/utils/activity";
  import { relativeTime } from "$lib/utils/relative-time";
  import type { EChartsOption } from "echarts";

  let { data } = $props();

  const stats = $derived(data.stats);
  const analytics = $derived(data.analytics);
  const hasActivity = $derived(stats.totalAttempts > 0);

  const acRate = $derived(
    stats.totalAttempts > 0
      ? ((stats.totalAc / stats.totalAttempts) * 100).toFixed(1) + "%"
      : "0%",
  );

  const hasDifficultyData = $derived(analytics.byDifficulty.some((d) => d.acCount > 0));
  const hasVerdictData = $derived(analytics.byVerdict.length > 0);
  const hasTagData = $derived(analytics.byTag.length > 0);
  const hasLanguageData = $derived(analytics.byLanguage.length > 0);

  const DEFAULT_THEME_COLORS = {
    success: "#7a8f6d",
    warning: "#d4a054",
    destructive: "#c4682d",
    chart1: "#c4682d",
    chart2: "#4d6f8f",
    chart3: "#8a6142",
    chart4: "#d4a054",
    chart5: "#7a8f6d",
    mutedFg: "#6b7280",
    panel: "#ffffff",
  };
  let themeColors = $state({ ...DEFAULT_THEME_COLORS });

  function resolveThemeColors() {
    if (typeof window === "undefined") return;
    const cs = getComputedStyle(document.documentElement);
    const read = (n: string, fallback: string) => cs.getPropertyValue(n).trim() || fallback;
    themeColors = {
      success: read("--success", DEFAULT_THEME_COLORS.success),
      warning: read("--warning", DEFAULT_THEME_COLORS.warning),
      destructive: read("--destructive", DEFAULT_THEME_COLORS.destructive),
      chart1: read("--chart-1", DEFAULT_THEME_COLORS.chart1),
      chart2: read("--chart-2", DEFAULT_THEME_COLORS.chart2),
      chart3: read("--chart-3", DEFAULT_THEME_COLORS.chart3),
      chart4: read("--chart-4", DEFAULT_THEME_COLORS.chart4),
      chart5: read("--chart-5", DEFAULT_THEME_COLORS.chart5),
      mutedFg: read("--muted-foreground", DEFAULT_THEME_COLORS.mutedFg),
      panel: read("--color-panel", DEFAULT_THEME_COLORS.panel),
    };
  }

  $effect(() => {
    resolveThemeColors();
    const observer = new MutationObserver(resolveThemeColors);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  });

  const difficultyColor = $derived<Record<string, string>>({
    easy: themeColors.success,
    medium: themeColors.warning,
    hard: themeColors.destructive,
  });

  const languagePalette = $derived([
    themeColors.chart1,
    themeColors.chart2,
    themeColors.chart3,
    themeColors.chart4,
    themeColors.chart5,
  ]);

  const difficultyOption: EChartsOption = $derived({
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)", transitionDuration: 0 },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    series: [
      {
        type: "pie",
        radius: ["40%", "70%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: themeColors.panel,
          borderWidth: 2,
        },
        label: { show: false },
        data: analytics.byDifficulty.map((d) => ({
          name: d.difficulty,
          value: d.acCount,
          itemStyle: { color: difficultyColor[d.difficulty] ?? themeColors.mutedFg },
        })),
      },
    ],
  });

  const verdictPalette = $derived<Record<string, string>>({
    accepted: themeColors.chart5,
    wrong_answer: themeColors.destructive,
    time_limit_exceeded: themeColors.warning,
    memory_limit_exceeded: themeColors.warning,
    runtime_error: themeColors.destructive,
    compile_error: themeColors.destructive,
    queued: themeColors.mutedFg,
    compiling: themeColors.mutedFg,
    running: themeColors.mutedFg,
  });

  const verdictOption: EChartsOption = $derived({
    title: {
      text: acRate,
      subtext: m.dashboard_acRate(),
      left: "center",
      top: "34%",
      textStyle: { fontSize: 26, fontWeight: 600 },
      subtextStyle: { fontSize: 12 },
    },
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)", transitionDuration: 0 },
    legend: { bottom: 0, textStyle: { fontSize: 11 }, type: "scroll" },
    series: [
      {
        type: "pie",
        radius: ["55%", "75%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: themeColors.panel,
          borderWidth: 2,
        },
        label: { show: false },
        data: analytics.byVerdict.map((v) => ({
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

  const tagOption: EChartsOption = $derived({
    grid: { left: 96, right: 24, top: 8, bottom: 24 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, transitionDuration: 0 },
    xAxis: { type: "value", axisLabel: { fontSize: 11 }, minInterval: 1 },
    yAxis: {
      type: "category",
      inverse: true,
      data: analytics.byTag.map((g) => g.tag),
      axisLabel: { fontSize: 12 },
    },
    series: [
      {
        type: "bar",
        data: analytics.byTag.map((g) => g.acCount),
        itemStyle: { color: themeColors.chart3, borderRadius: [0, 4, 4, 0] },
        barMaxWidth: 18,
      },
    ],
  });

  const languageOption: EChartsOption = $derived({
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)", transitionDuration: 0 },
    legend: { bottom: 0, textStyle: { fontSize: 11 }, type: "scroll" },
    series: [
      {
        type: "pie",
        radius: ["40%", "70%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: themeColors.panel,
          borderWidth: 2,
        },
        label: { show: false },
        data: analytics.byLanguage.map((l, i) => ({
          name: l.language,
          value: l.count,
          itemStyle: {
            color: languagePalette[i % languagePalette.length] ?? themeColors.mutedFg,
          },
        })),
      },
    ],
  });
</script>

<PageContainer class="fade-up">
  <PageHeader
    eyebrow={m.dashboard_eyebrow()}
    title={m.dashboard_welcome({ username: data.username })}
    description={m.dashboard_subtitle()}
  />

  {#if !hasActivity}
    <WelcomeGuide username={data.username} />
  {:else}
    <div class="space-y-6">
      <Card variant="surface" size="lg">
        <div class="flex flex-col gap-6">
          <div class="flex items-baseline justify-end gap-4">
            <span class="text-caption text-muted-foreground">
              {m.dashboard_last30Days()}
            </span>
          </div>
          <div class="grid grid-cols-2 gap-6 md:grid-cols-4">
            <div class="flex flex-col gap-1">
              <span class="text-caption text-muted-foreground">
                {m.dashboard_totalAc()}
              </span>
              <span class="text-headline font-semibold tabular-nums">
                {stats.totalAc}
              </span>
            </div>
            <div class="flex flex-col gap-1 md:border-l md:border-border-subtle md:pl-6">
              <span class="text-caption text-muted-foreground">
                {m.dashboard_totalAttempts()}
              </span>
              <span class="text-headline font-semibold tabular-nums">
                {stats.totalAttempts}
              </span>
            </div>
            <div class="flex flex-col gap-1 md:border-l md:border-border-subtle md:pl-6">
              <span class="text-caption text-muted-foreground">
                {m.dashboard_acRate()}
              </span>
              <span class="text-headline font-semibold tabular-nums">{acRate}</span>
            </div>
            <div class="flex flex-col gap-1 md:border-l md:border-border-subtle md:pl-6">
              <span class="text-caption text-muted-foreground">
                {m.dashboard_practiceDays()}
              </span>
              {#await data.streamed.activity}
                <div aria-busy="true" aria-live="polite">
                  <Skeleton class="h-8 w-12" />
                </div>
              {:then activity}
                <span class="text-headline font-semibold tabular-nums">
                  {buildActivityModel(activity, new Date(), 365).heatmapDays.filter(
                    (d) => d.submissionCount > 0,
                  ).length}
                </span>
              {:catch}
                <span class="text-headline font-semibold tabular-nums text-muted-foreground">
                  —
                </span>
              {/await}
            </div>
          </div>
        </div>
      </Card>

      {#await data.streamed.activity}
        <div aria-busy="true" aria-live="polite" class="contents">
          <Card variant="surface" size="lg">
            <h2 class="mb-4 text-title-sm font-semibold">
              {m.dashboard_activityChart()}
            </h2>
            <Skeleton class="h-48 w-full" />
          </Card>
          <div class="grid gap-4 md:grid-cols-2">
            <Card variant="surface" size="lg">
              <Skeleton class="mb-4 h-5 w-24" />
              <Skeleton class="h-20 w-full" />
            </Card>
            <Card variant="surface" size="lg">
              <Skeleton class="mb-4 h-5 w-32" />
              <Skeleton class="h-40 w-full" />
            </Card>
          </div>
        </div>
      {:then activity}
        {@const activityModel = buildActivityModel(activity, new Date(), 365)}
        {@const dailyActivity = activityModel.heatmapDays}
        {@const hasHeatmapData = dailyActivity.some((d) => d.acCount > 0)}
        <Card variant="surface" size="lg">
          <h2 class="mb-4 text-title-sm font-semibold">
            {m.dashboard_activityChart()}
          </h2>
          {#if hasHeatmapData}
            <ActivityHeatmap data={dailyActivity} />
          {:else}
            <EmptyState
              variant="minimal"
              icon={LineChart}
              title={m.dashboard_noActivity()}
              description={m.dashboard_startPracticing()}
            />
          {/if}
        </Card>

        <div class="grid gap-4 md:grid-cols-2">
          <StreakCard streakDays={activityModel.streakDays} />
          <WeeklyTrendCard data={activityModel.weeklyTrend} />
        </div>
      {:catch}
        <Card variant="surface" size="lg">
          <EmptyState
            variant="minimal"
            icon={AlertTriangle}
            title={m.dashboard_loadError()}
            description={m.dashboard_loadErrorDescription()}
          />
        </Card>
      {/await}

      <div class="grid gap-4">
        <Card variant="surface" size="lg">
          <h2 class="mb-4 text-title-sm font-semibold">
            {m.dashboard_tagProficiency()}
          </h2>
          {#if hasTagData}
            <EChart option={tagOption} class="h-64 w-full" />
          {:else}
            <EmptyState variant="minimal" icon={PieChart} title={m.dashboard_noTagData()} />
          {/if}
        </Card>

        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card variant="surface" size="lg">
            <h2 class="mb-4 text-title-sm font-semibold">
              {m.dashboard_difficultyDist()}
            </h2>
            {#if hasDifficultyData}
              <EChart option={difficultyOption} class="h-56 w-full" />
            {:else}
              <EmptyState variant="minimal" icon={PieChart} title={m.dashboard_noTagData()} />
            {/if}
          </Card>

          <Card variant="surface" size="lg">
            <h2 class="mb-4 text-title-sm font-semibold">
              {m.dashboard_verdictDistribution()}
            </h2>
            {#if hasVerdictData}
              <EChart option={verdictOption} class="h-56 w-full" />
            {:else}
              <EmptyState variant="minimal" icon={PieChart} title={m.dashboard_noActivity()} />
            {/if}
          </Card>

          <Card variant="surface" size="lg">
            <h2 class="mb-4 text-title-sm font-semibold">
              {m.dashboard_languageDist()}
            </h2>
            {#if hasLanguageData}
              <EChart option={languageOption} class="h-56 w-full" />
            {:else}
              <EmptyState variant="minimal" icon={PieChart} title={m.dashboard_noActivity()} />
            {/if}
          </Card>
        </div>
      </div>

      <Card variant="surface" size="lg">
        <h2 class="mb-4 text-title-sm font-semibold">
          {m.dashboard_recentActivity()}
        </h2>
        {#if data.recentSubmissions.length > 0}
          <ul class="space-y-3">
            {#each data.recentSubmissions.slice(0, 5) as sub (sub.id)}
              <li class="flex items-center gap-3 text-body-sm">
                <time class="shrink-0 text-caption text-muted-foreground tabular-nums">
                  {relativeTime(sub.createdAt)}
                </time>
                <VerdictBadge verdict={sub.status} />
                <a href="/problems/{sub.problem.id}" class="truncate hover:underline">
                  {formatProblemDisplayName(sub.problem)}
                </a>
                <span class="shrink-0 text-caption text-muted-foreground">
                  ({sub.language})
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <EmptyState
            variant="minimal"
            icon={Code2}
            title={m.dashboard_noActivity()}
            description={m.dashboard_startPracticing()}
            actionHref="/problems"
            actionLabel={m.dashboard_browseProblems()}
          />
        {/if}
      </Card>

      {#await data.streamed.suggestedProblems}
        <div aria-busy="true" aria-live="polite">
          <Card variant="surface" size="lg">
            <Skeleton class="mb-4 h-6 w-40" />
            <div class="flex flex-col gap-4">
              <Skeleton class="h-6 w-full" />
              <Skeleton class="h-6 w-11/12" />
              <Skeleton class="h-6 w-10/12" />
              <Skeleton class="h-6 w-9/12" />
              <Skeleton class="h-6 w-8/12" />
            </div>
          </Card>
        </div>
      {:then suggestedProblems}
        <SuggestedProblemsCard problems={suggestedProblems} />
      {:catch}
        <Card variant="surface" size="lg">
          <EmptyState
            variant="minimal"
            icon={AlertTriangle}
            title={m.dashboard_loadError()}
            description={m.dashboard_loadErrorDescription()}
          />
        </Card>
      {/await}
    </div>
  {/if}
</PageContainer>
