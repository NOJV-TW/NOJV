<script lang="ts">
  import { onMount } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { AlertTriangle, Code2, LineChart, PieChart } from "@lucide/svelte";
  import { Button } from "$lib/components/primitives/ui/button/index.js";
  import EChart from "$lib/components/primitives/charts/EChart.svelte";
  import ActivityHeatmap from "$lib/components/features/dashboard/ActivityHeatmap.svelte";
  import PlatformOverview from "$lib/components/features/dashboard/PlatformOverview.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import VerdictBadge from "$lib/components/primitives/ui/VerdictBadge.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import TabStrip from "$lib/components/primitives/visual/TabStrip.svelte";
  import WelcomeGuide from "$lib/components/features/dashboard/WelcomeGuide.svelte";
  import { Skeleton } from "$lib/components/primitives/ui/skeleton";
  import { formatVerdictLabel } from "$lib/utils/verdict-style";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
  import { buildActivityModel } from "$lib/utils/activity";
  import { relativeTime } from "$lib/utils/relative-time";
  import { formatChartSummary } from "$lib/utils/chart-summary";
  import { startAutomaticTour } from "$lib/onboarding/engine";
  import { studentWelcomeIntro } from "$lib/onboarding/student-tour";
  import { teacherWelcomeIntro } from "$lib/onboarding/teacher-tour";
  import type { EChartsOption } from "echarts";

  let { data } = $props();

  const stats = $derived(data.stats);
  const analytics = $derived(data.analytics);
  const hasActivity = $derived(stats.totalAttempts > 0);

  const viewTabs = $derived([
    { value: "personal", label: m.dashboard_viewPersonal() },
    { value: "server", label: m.dashboard_viewServer() },
  ]);

  function setView(next: string) {
    const url = new URL(page.url);
    if (next === "server") url.searchParams.set("view", "server");
    else url.searchParams.delete("view");
    void goto(`?${url.searchParams.toString()}`, {
      keepFocus: true,
      replaceState: true,
      noScroll: true,
    });
  }

  const acRate = $derived(
    stats.totalAttempts > 0
      ? ((stats.totalAc / stats.totalAttempts) * 100).toFixed(1) + "%"
      : "0%",
  );

  const hasDifficultyData = $derived(analytics.byDifficulty.some((d) => d.acCount > 0));
  const hasVerdictData = $derived(analytics.byVerdict.length > 0);
  const hasTagData = $derived(analytics.byTag.length > 0);
  const hasLanguageData = $derived(analytics.byLanguage.length > 0);

  async function claimAutomaticTour(): Promise<boolean> {
    try {
      const response = await fetch("/api/account/onboarding-tour", {
        method: "POST",
        headers: { "x-requested-with": "fetch" },
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { show?: unknown };
      return body.show === true;
    } catch {
      return false;
    }
  }

  onMount(() => {
    const intro =
      data.automaticTourRole === "student"
        ? studentWelcomeIntro
        : data.automaticTourRole === "teacher"
          ? teacherWelcomeIntro
          : null;
    if (intro) void startAutomaticTour(intro, claimAutomaticTour);
  });

  const DEFAULT_THEME_COLORS = {
    success: "#2f9d6b",
    warning: "#c98a1a",
    destructive: "#d24a3a",
    info: "#3b82c4",
    verdictOrange: "#e0742a",
    verdictPurple: "#9a5cd0",
    verdictCyan: "#2bb0b8",
    chart1: "#1d8c9c",
    chart2: "#4d6f8f",
    chart3: "#2f9d6b",
    chart4: "#c98a1a",
    chart5: "#7a8f6d",
    mutedFg: "#6b7280",
    foreground: "#1f2937",
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
      info: read("--info", DEFAULT_THEME_COLORS.info),
      verdictOrange: read("--verdict-orange", DEFAULT_THEME_COLORS.verdictOrange),
      verdictPurple: read("--verdict-purple", DEFAULT_THEME_COLORS.verdictPurple),
      verdictCyan: read("--verdict-cyan", DEFAULT_THEME_COLORS.verdictCyan),
      chart1: read("--chart-1", DEFAULT_THEME_COLORS.chart1),
      chart2: read("--chart-2", DEFAULT_THEME_COLORS.chart2),
      chart3: read("--chart-3", DEFAULT_THEME_COLORS.chart3),
      chart4: read("--chart-4", DEFAULT_THEME_COLORS.chart4),
      chart5: read("--chart-5", DEFAULT_THEME_COLORS.chart5),
      mutedFg: read("--muted-foreground", DEFAULT_THEME_COLORS.mutedFg),
      foreground: read("--foreground", DEFAULT_THEME_COLORS.foreground),
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
        data: analytics.byDifficulty.map((d) => ({
          name: d.difficulty,
          value: d.acCount,
          itemStyle: { color: difficultyColor[d.difficulty] ?? themeColors.mutedFg },
        })),
      },
    ],
  });

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

  const TAG_VISIBLE = 7;

  const tagScrolls = $derived(analytics.byTag.length > TAG_VISIBLE);

  const tagMax = $derived(Math.max(1, ...analytics.byTag.map((g) => g.acCount)));

  const tagOption: EChartsOption = $derived({
    animation: false,
    grid: { left: 96, right: tagScrolls ? 30 : 24, top: 8, bottom: 24 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      appendToBody: true,
      extraCssText: "pointer-events:none;",
      transitionDuration: 0,
    },
    ...(tagScrolls
      ? {
          dataZoom: [
            {
              type: "inside",
              yAxisIndex: 0,
              startValue: 0,
              endValue: TAG_VISIBLE - 1,
              zoomLock: true,
              zoomOnMouseWheel: false,
              moveOnMouseWheel: true,
              moveOnMouseMove: false,
            },
            {
              type: "slider",
              yAxisIndex: 0,
              right: 6,
              width: 10,
              startValue: 0,
              endValue: TAG_VISIBLE - 1,
              zoomLock: true,
              brushSelect: false,
              showDetail: false,
              handleSize: 0,
              moveHandleSize: 0,
              fillerColor: "rgba(130,130,145,0.32)",
              borderColor: "transparent",
              backgroundColor: "transparent",
              dataBackground: { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } },
              selectedDataBackground: { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } },
            },
          ],
        }
      : {}),
    xAxis: {
      type: "value",
      min: 0,
      max: tagMax,
      axisLabel: { fontSize: 11, color: themeColors.mutedFg },
      minInterval: 1,
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: analytics.byTag.map((g) => g.tag),
      axisLabel: { fontSize: 12, color: themeColors.foreground },
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

{#snippet errorCard()}
  <Card variant="surface" size="lg">
    <div class="flex flex-col items-center gap-3">
      <EmptyState
        variant="minimal"
        icon={AlertTriangle}
        title={m.dashboard_loadError()}
        description={m.dashboard_loadErrorDescription()}
      />
      <Button variant="outline" size="sm" onclick={() => invalidateAll()}>
        {m.common_retry()}
      </Button>
    </div>
  </Card>
{/snippet}

<PageContainer class="fade-up">
  <PageHeader
    eyebrow={m.dashboard_eyebrow()}
    title={m.dashboard_welcome({ username: data.username })}
    description={m.dashboard_subtitle()}
  />

  <div class="mb-6">
    <TabStrip tabs={viewTabs} activeTabValue={data.view} onChange={setView} />
  </div>

  {#if data.view === "server" && data.platform}
    <PlatformOverview overview={data.platform} {themeColors} />
  {:else if !hasActivity}
    <WelcomeGuide username={data.displayName} platformRole={data.platformRole} />
  {:else}
    <div class="space-y-6">
      <div class="grid gap-4 lg:grid-cols-2">
        <Card variant="surface" size="lg" data-tour="dashboard-stats">
          <div class="flex flex-col gap-6">
            <div class="flex items-baseline justify-between gap-4">
              <h2 class="text-title-sm font-semibold">{m.dashboard_statsTitle()}</h2>
              <span class="text-caption text-muted-foreground">
                {m.dashboard_last30Days()}
              </span>
            </div>
            <div class="grid grid-cols-2 gap-x-6 gap-y-5">
              <div class="flex flex-col gap-1">
                <span class="text-caption text-muted-foreground">
                  {m.dashboard_totalAc()}
                </span>
                <span class="text-headline font-semibold tabular-nums">
                  {stats.totalAc}
                </span>
              </div>
              <div class="flex flex-col gap-1 border-l border-border-subtle pl-6">
                <span class="text-caption text-muted-foreground">
                  {m.dashboard_totalAttempts()}
                </span>
                <span class="text-headline font-semibold tabular-nums">
                  {stats.totalAttempts}
                </span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-caption text-muted-foreground">
                  {m.dashboard_acRate()}
                </span>
                <span class="text-headline font-semibold tabular-nums">{acRate}</span>
              </div>
              <div class="flex flex-col gap-1 border-l border-border-subtle pl-6">
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

        <Card variant="surface" size="lg" data-tour="dashboard-charts">
          <h2 class="mb-4 text-title-sm font-semibold">
            {m.dashboard_tagProficiency()}
          </h2>
          {#if hasTagData}
            <EChart
              option={tagOption}
              ariaLabel={m.dashboard_tagProficiency()}
              summary={formatChartSummary(
                analytics.byTag.map((entry) => ({
                  label: entry.tag,
                  value: entry.acCount,
                })),
              )}
              class="h-56 w-full"
            />
          {:else}
            <EmptyState variant="minimal" icon={PieChart} title={m.dashboard_noTagData()} />
          {/if}
        </Card>
      </div>

      {#await data.streamed.activity}
        <div aria-busy="true" aria-live="polite" class="contents">
          <Card variant="surface" size="lg">
            <h2 class="mb-4 text-title-sm font-semibold">
              {m.dashboard_activityChart()}
            </h2>
            <Skeleton class="h-48 w-full" />
          </Card>
        </div>
      {:then activity}
        {@const activityModel = buildActivityModel(activity, new Date(), 365)}
        {@const dailyActivity = activityModel.heatmapDays}
        {@const hasHeatmapData = dailyActivity.some((d) => d.acCount > 0)}
        <Card variant="surface" size="lg" data-tour="dashboard-heatmap">
          {#if hasHeatmapData}
            <ActivityHeatmap data={dailyActivity} title={m.dashboard_activityChart()} />
          {:else}
            <h2 class="mb-4 text-title-sm font-semibold">
              {m.dashboard_activityChart()}
            </h2>
            <EmptyState
              variant="minimal"
              icon={LineChart}
              title={m.dashboard_noActivity()}
              description={m.dashboard_startPracticing()}
            />
          {/if}
        </Card>
      {:catch}
        {@render errorCard()}
      {/await}

      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-tour="dashboard-distributions">
        <Card variant="surface" size="lg">
          <h2 class="mb-4 text-title-sm font-semibold">
            {m.dashboard_difficultyDist()}
          </h2>
          {#if hasDifficultyData}
            <EChart
              option={difficultyOption}
              ariaLabel={m.dashboard_difficultyDist()}
              summary={formatChartSummary(
                analytics.byDifficulty.map((entry) => ({
                  label: entry.difficulty,
                  value: entry.acCount,
                })),
              )}
              class="h-56 w-full"
            />
          {:else}
            <EmptyState variant="minimal" icon={PieChart} title={m.dashboard_noTagData()} />
          {/if}
        </Card>

        <Card variant="surface" size="lg">
          <h2 class="mb-4 text-title-sm font-semibold">
            {m.dashboard_verdictDistribution()}
          </h2>
          {#if hasVerdictData}
            <div class="relative">
              <EChart
                option={verdictOption}
                ariaLabel={m.dashboard_verdictDistribution()}
                summary={formatChartSummary(
                  analytics.byVerdict.map((entry) => ({
                    label: formatVerdictLabel(entry.status),
                    value: entry.count,
                  })),
                )}
                class="h-56 w-full"
              />
              <div
                class="pointer-events-none absolute inset-x-0 top-[45%] flex -translate-y-1/2 flex-col items-center"
              >
                <span class="text-headline font-semibold leading-none tabular-nums">
                  {acRate}
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
          <h2 class="mb-4 text-title-sm font-semibold">
            {m.dashboard_languageDist()}
          </h2>
          {#if hasLanguageData}
            <EChart
              option={languageOption}
              ariaLabel={m.dashboard_languageDist()}
              summary={formatChartSummary(
                analytics.byLanguage.map((entry) => ({
                  label: entry.language,
                  value: entry.count,
                })),
              )}
              class="h-56 w-full"
            />
          {:else}
            <EmptyState variant="minimal" icon={PieChart} title={m.dashboard_noActivity()} />
          {/if}
        </Card>
      </div>

      <Card variant="surface" size="lg" data-tour="dashboard-recent">
        <h2 class="mb-4 text-title-sm font-semibold">
          {m.dashboard_recentActivity()}
        </h2>
        {#if data.recentSubmissions.length > 0}
          <table class="w-full table-fixed text-body-sm">
            <tbody class="divide-y divide-border-subtle">
              {#each data.recentSubmissions.slice(0, 5) as sub (sub.id)}
                <tr class="transition-colors hover:bg-muted/30">
                  <td
                    class="w-24 whitespace-nowrap py-3.5 pr-4 text-caption text-muted-foreground tabular-nums"
                  >
                    {relativeTime(sub.createdAt)}
                  </td>
                  <td class="py-3.5 pr-6">
                    <a
                      href="/problems/{sub.problem.id}"
                      class="block truncate font-medium hover:underline"
                    >
                      {formatProblemDisplayName(sub.problem)}
                    </a>
                  </td>
                  <td class="w-44 py-3.5 pr-4">
                    <VerdictBadge verdict={sub.status} />
                  </td>
                  <td
                    class="hidden w-24 whitespace-nowrap py-3.5 text-right text-caption text-muted-foreground sm:table-cell"
                  >
                    {sub.language}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
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
    </div>
  {/if}
</PageContainer>
