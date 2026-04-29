<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { Code2, LineChart, PieChart } from "@lucide/svelte";
  import EChart from "$lib/components/charts/EChart.svelte";
  import ActivityHeatmap from "$lib/components/charts/ActivityHeatmap.svelte";
  import { Card } from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import PageContainer from "$lib/components/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/layout/PageHeader.svelte";
  import StreakCard from "$lib/components/dashboard/StreakCard.svelte";
  import WeeklyTrendCard from "$lib/components/dashboard/WeeklyTrendCard.svelte";
  import SuggestedProblemsCard from "$lib/components/dashboard/SuggestedProblemsCard.svelte";
  import { formatVerdictLabel } from "$lib/types";
  import type { BadgeVariant } from "$lib/components/ui/badge";
  import type { EChartsOption } from "echarts";

  let { data } = $props();

  const stats = $derived(data.stats);
  const analytics = $derived(data.analytics);
  const dailyActivity = $derived(data.dailyActivity);

  const acRate = $derived(
    stats.totalAttempts > 0
      ? ((stats.totalAc / stats.totalAttempts) * 100).toFixed(1) + "%"
      : "0%"
  );

  const practiceDays = $derived(
    dailyActivity.filter((d) => d.submissionCount > 0).length
  );

  const hasHeatmapData = $derived(dailyActivity.some((d) => d.acCount > 0));
  const hasDifficultyData = $derived(
    analytics.byDifficulty.some((d) => d.acCount > 0)
  );
  const hasVerdictData = $derived(analytics.byVerdict.length > 0);
  const hasTagData = $derived(analytics.byTag.length > 0);

  const difficultyColor: Record<string, string> = {
    easy: "var(--success)",
    medium: "var(--warning)",
    hard: "var(--destructive)"
  };

  const difficultyOption: EChartsOption = $derived({
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    series: [
      {
        type: "pie",
        radius: ["40%", "70%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: "var(--color-panel)",
          borderWidth: 2
        },
        label: { show: false },
        data: analytics.byDifficulty.map((d) => ({
          name: d.difficulty,
          value: d.acCount,
          itemStyle: { color: difficultyColor[d.difficulty] ?? "var(--muted-foreground)" }
        }))
      }
    ]
  });

  const verdictPalette: Record<string, string> = {
    accepted: "var(--chart-5)",
    wrong_answer: "var(--destructive)",
    time_limit_exceeded: "var(--warning)",
    memory_limit_exceeded: "var(--warning)",
    runtime_error: "var(--destructive)",
    compile_error: "var(--destructive)",
    queued: "var(--muted-foreground)",
    compiling: "var(--muted-foreground)",
    running: "var(--muted-foreground)"
  };

  const verdictOption: EChartsOption = $derived({
    title: {
      text: acRate,
      subtext: m.dashboard_acRate(),
      left: "center",
      top: "34%",
      textStyle: { fontSize: 26, fontWeight: 600 },
      subtextStyle: { fontSize: 12 }
    },
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: { bottom: 0, textStyle: { fontSize: 11 }, type: "scroll" },
    series: [
      {
        type: "pie",
        radius: ["55%", "75%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: "var(--color-panel)",
          borderWidth: 2
        },
        label: { show: false },
        data: analytics.byVerdict.map((v) => ({
          name: formatVerdictLabel(v.status),
          value: v.count,
          itemStyle: {
            color: verdictPalette[v.status] ?? "var(--muted-foreground)",
            borderWidth: v.status === "accepted" ? 3 : 2,
            opacity: v.status === "accepted" ? 1 : 0.5
          }
        }))
      }
    ]
  });

  const tagOption: EChartsOption = $derived({
    grid: { left: 96, right: 24, top: 8, bottom: 24 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", axisLabel: { fontSize: 11 }, minInterval: 1 },
    yAxis: {
      type: "category",
      inverse: true,
      data: analytics.byTag.map((g) => g.tag),
      axisLabel: { fontSize: 12 }
    },
    series: [
      {
        type: "bar",
        data: analytics.byTag.map((g) => g.acCount),
        itemStyle: { color: "var(--chart-3)", borderRadius: [0, 4, 4, 0] },
        barMaxWidth: 18
      }
    ]
  });

  function verdictToBadgeVariant(status: string): BadgeVariant {
    switch (status) {
      case "accepted":
        return "verdict-ac";
      case "wrong_answer":
        return "verdict-wa";
      case "time_limit_exceeded":
        return "verdict-tle";
      case "memory_limit_exceeded":
        return "verdict-mle";
      case "runtime_error":
        return "verdict-re";
      case "compile_error":
        return "verdict-ce";
      case "queued":
      case "compiling":
      case "running":
        return "verdict-pending";
      default:
        return "muted";
    }
  }

  function timeAgo(date: Date | string): string {
    const now = Date.now();
    const then = new Date(date).getTime();
    const diffMs = now - then;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
</script>

<PageContainer>
  <PageHeader
    eyebrow={m.dashboard_eyebrow()}
    title={m.dashboard_welcome({ username: data.username })}
    description={m.dashboard_subtitle()}
  />

  <div class="space-y-6">
    <!-- Section 1 — Stat strip (kept here so Phase 5 can revisit; only the
         eyebrow/title above moved into <PageHeader>). -->
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
            <span class="text-headline font-semibold tabular-nums">
              {practiceDays}
            </span>
          </div>
        </div>
      </div>
    </Card>

  <!-- Section 2 — Activity Heatmap -->
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

  <!-- Section 2.5 — Streak + Weekly Trend -->
  <div class="grid gap-4 md:grid-cols-2">
    <StreakCard streakDays={data.streakDays} />
    <WeeklyTrendCard data={data.weeklyTrend} />
  </div>

  <!-- Section 3 — Ability Profile -->
  <div class="grid gap-4">
    <Card variant="surface" size="lg">
      <h2 class="mb-4 text-title-sm font-semibold">
        {m.dashboard_tagProficiency()}
      </h2>
      {#if hasTagData}
        <EChart option={tagOption} class="h-64 w-full" />
      {:else}
        <EmptyState
          variant="minimal"
          icon={PieChart}
          title={m.dashboard_noTagData()}
        />
      {/if}
    </Card>

    <div class="grid gap-4 lg:grid-cols-2">
      <Card variant="surface" size="lg">
        <h2 class="mb-4 text-title-sm font-semibold">
          {m.dashboard_difficultyDist()}
        </h2>
        {#if hasDifficultyData}
          <EChart option={difficultyOption} class="h-56 w-full" />
        {:else}
          <EmptyState
            variant="minimal"
            icon={PieChart}
            title={m.dashboard_noTagData()}
          />
        {/if}
      </Card>

      <Card variant="surface" size="lg">
        <h2 class="mb-4 text-title-sm font-semibold">
          {m.dashboard_verdictDistribution()}
        </h2>
        {#if hasVerdictData}
          <EChart option={verdictOption} class="h-56 w-full" />
        {:else}
          <EmptyState
            variant="minimal"
            icon={PieChart}
            title={m.dashboard_noActivity()}
          />
        {/if}
      </Card>
    </div>
  </div>

  <!-- Section 4 — Recent Submissions -->
  <Card variant="surface" size="lg">
    <h2 class="mb-4 text-title-sm font-semibold">
      {m.dashboard_recentActivity()}
    </h2>
    {#if data.recentSubmissions.length > 0}
      <ul class="space-y-3">
        {#each data.recentSubmissions.slice(0, 5) as sub (sub.id)}
          <li class="flex items-center gap-3 text-body-sm">
            <time
              class="shrink-0 text-caption text-muted-foreground tabular-nums"
            >
              {timeAgo(sub.createdAt)}
            </time>
            <Badge variant={verdictToBadgeVariant(sub.status)} size="sm">
              {formatVerdictLabel(sub.status)}
            </Badge>
            <a
              href="/problems/{sub.problem.id}"
              class="truncate hover:underline"
            >
              {sub.problem.title}
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

  <!-- Section 5 — Suggested problems -->
  <SuggestedProblemsCard problems={data.suggestedProblems} />
  </div>
</PageContainer>
