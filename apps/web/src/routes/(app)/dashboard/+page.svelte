<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import {
    BookOpen,
    CalendarClock,
    Code2,
    Lightbulb,
    LineChart,
    Megaphone,
    PieChart
  } from "@lucide/svelte";
  import EChart from "$lib/components/charts/EChart.svelte";
  import { Card } from "$lib/components/ui/card";
  import Section from "$lib/components/ui/Section.svelte";
  import StatCard from "$lib/components/ui/StatCard.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import { formatVerdictLabel } from "$lib/types";
  import type { BadgeVariant } from "$lib/components/ui/badge";
  import type { EChartsOption } from "echarts";

  let { data } = $props();

  const stats = $derived(data.stats);

  // Activity chart reads from the `UserDailyActivity` table via the
  // server-side load. TODO: add a domain helper to compute the language
  // + difficulty pie histograms on demand from `Submission` / `Problem`.
  const dailyActivity = $derived(data.dailyActivity);
  const hasActivity = $derived(dailyActivity.length > 0);

  const acRate = $derived(
    stats.totalAttempts > 0
      ? ((stats.totalAc / stats.totalAttempts) * 100).toFixed(1) + "%"
      : "0%"
  );

  // -- Activity line chart (last 30 days) --
  const activityOption: EChartsOption = $derived({
    grid: { left: 40, right: 16, top: 16, bottom: 32 },
    xAxis: {
      type: "category",
      data: dailyActivity.map((d) => d.date),
      axisLabel: { fontSize: 11 }
    },
    yAxis: { type: "value", minInterval: 1, axisLabel: { fontSize: 11 } },
    series: [
      {
        type: "line",
        data: dailyActivity.map((d) => d.acCount),
        smooth: true,
        areaStyle: { opacity: 0.15 },
        lineStyle: { width: 2 },
        itemStyle: { color: "var(--chart-5)" }
      }
    ],
    tooltip: { trigger: "axis" }
  });

  const analytics = $derived(data.analytics);
  const hasDifficultyData = $derived(
    analytics.byDifficulty.some((d) => d.acCount > 0)
  );
  const hasLanguageData = $derived(analytics.byLanguage.length > 0);
  const hasVerdictData = $derived(analytics.byVerdict.length > 0);

  // Difficulty palette — aligned with the tag pill colours in the problem list.
  const difficultyColor: Record<string, string> = {
    easy: "#10b981",
    medium: "#f59e0b",
    hard: "#ef4444"
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
        itemStyle: { borderRadius: 6, borderColor: "var(--color-panel)", borderWidth: 2 },
        label: { show: false },
        data: analytics.byDifficulty.map((d) => ({
          name: d.difficulty,
          value: d.acCount,
          itemStyle: { color: difficultyColor[d.difficulty] }
        }))
      }
    ]
  });

  const languageOption: EChartsOption = $derived({
    grid: { left: 80, right: 16, top: 16, bottom: 24 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", axisLabel: { fontSize: 11 } },
    yAxis: {
      type: "category",
      data: analytics.byLanguage.map((g) => g.language),
      axisLabel: { fontSize: 11 }
    },
    series: [
      {
        type: "bar",
        data: analytics.byLanguage.map((g) => g.count),
        itemStyle: { color: "var(--chart-3)", borderRadius: [0, 4, 4, 0] },
        barMaxWidth: 20
      }
    ]
  });

  const verdictPalette: Record<string, string> = {
    accepted: "#10b981",
    wrong_answer: "#ef4444",
    time_limit_exceeded: "#f59e0b",
    memory_limit_exceeded: "#f59e0b",
    runtime_error: "#ef4444",
    compile_error: "#ef4444",
    queued: "#94a3b8",
    compiling: "#94a3b8",
    running: "#94a3b8"
  };

  const verdictOption: EChartsOption = $derived({
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: { bottom: 0, textStyle: { fontSize: 11 }, type: "scroll" },
    series: [
      {
        type: "pie",
        radius: ["40%", "70%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: "var(--color-panel)", borderWidth: 2 },
        label: { show: false },
        data: analytics.byVerdict.map((v) => ({
          name: formatVerdictLabel(v.status),
          value: v.count,
          itemStyle: { color: verdictPalette[v.status] ?? "#64748b" }
        }))
      }
    ]
  });

  function formatAssessmentTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

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

<div class="space-y-6">
  <!-- Welcome -->
  <h2 class="font-display text-title-lg">
    {m.dashboard_welcome({ username: data.username })}
  </h2>

  <!-- Stats cards -->
  <div class="grid gap-4 sm:grid-cols-3">
    <StatCard label={m.dashboard_totalAc()} value={stats.totalAc} />
    <StatCard label={m.dashboard_totalAttempts()} value={stats.totalAttempts} />
    <StatCard label={m.dashboard_acRate()} value={acRate} />
  </div>

  <!-- Activity chart -->
  <Card variant="surface" size="lg">
    <Section>
      {#snippet header()}
        <h2>{m.dashboard_activityChart()}</h2>
      {/snippet}
      {#if hasActivity}
        <EChart option={activityOption} class="h-56 w-full" />
      {:else}
        <EmptyState
          variant="minimal"
          icon={LineChart}
          title={m.dashboard_noActivity()}
          description={m.dashboard_startPracticing()}
        />
      {/if}
    </Section>
  </Card>

  <!-- Analytics grid: difficulty pie + language bar + verdict pie -->
  <div class="grid gap-4 lg:grid-cols-3">
    <Card variant="surface" size="lg">
      <Section>
        {#snippet header()}
          <h2>已解難度分布</h2>
        {/snippet}
        {#if hasDifficultyData}
          <EChart option={difficultyOption} class="h-56 w-full" />
        {:else}
          <EmptyState variant="minimal" icon={PieChart} title="尚無 AC 紀錄" />
        {/if}
      </Section>
    </Card>

    <Card variant="surface" size="lg">
      <Section>
        {#snippet header()}
          <h2>語言提交分布</h2>
        {/snippet}
        {#if hasLanguageData}
          <EChart option={languageOption} class="h-56 w-full" />
        {:else}
          <EmptyState variant="minimal" icon={Code2} title="尚無提交" />
        {/if}
      </Section>
    </Card>

    <Card variant="surface" size="lg">
      <Section>
        {#snippet header()}
          <h2>判題結果分布</h2>
        {/snippet}
        {#if hasVerdictData}
          <EChart option={verdictOption} class="h-56 w-full" />
        {:else}
          <EmptyState variant="minimal" icon={PieChart} title="尚無提交" />
        {/if}
      </Section>
    </Card>
  </div>

  <!-- Courses + Upcoming assessments grid -->
  <div class="grid gap-4 lg:grid-cols-2">
    <Card variant="surface" size="lg">
      <Section>
        {#snippet header()}
          <h2>我的課程</h2>
        {/snippet}
        {#if data.courses.length > 0}
          <ul class="grid gap-2">
            {#each data.courses as course (course.slug)}
              <li>
                <a
                  href="/courses/{course.slug}"
                  class="flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2 text-body-sm transition-[background-color] duration-fast ease-out-soft hover:bg-[color:var(--color-panel)]"
                >
                  <span class="truncate font-medium">{course.title}</span>
                  <span class="shrink-0 text-caption text-muted-foreground tabular-nums">
                    {course.assessmentCount} 作業 · {course.memberCount} 人
                  </span>
                </a>
              </li>
            {/each}
          </ul>
        {:else}
          <EmptyState
            variant="minimal"
            icon={BookOpen}
            title="尚未加入任何課程"
            actionHref="/courses"
            actionLabel="瀏覽課程"
          />
        {/if}
      </Section>
    </Card>

    <Card variant="surface" size="lg">
      <Section>
        {#snippet header()}
          <h2>即將到來的作業</h2>
        {/snippet}
        {#if data.upcomingAssessments.length > 0}
          <ul class="space-y-2">
            {#each data.upcomingAssessments as a (a.courseSlug + "/" + a.slug)}
              <li>
                <a
                  href="/courses/{a.courseSlug}/assignments/{a.slug}"
                  class="flex items-start justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2 text-body-sm transition-[background-color] duration-fast ease-out-soft hover:bg-[color:var(--color-panel)]"
                >
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-medium">{a.title}</p>
                    <p class="truncate text-caption text-muted-foreground">
                      {a.courseTitle}
                    </p>
                  </div>
                  <div class="shrink-0 text-right">
                    <p class="text-caption font-medium tabular-nums {a.windowStateColor}">
                      {formatAssessmentTime(a.dueAt)}
                    </p>
                    <p class="text-caption text-muted-foreground">{a.windowState}</p>
                  </div>
                </a>
              </li>
            {/each}
          </ul>
        {:else}
          <EmptyState
            variant="minimal"
            icon={CalendarClock}
            title="目前沒有即將到來的作業"
          />
        {/if}
      </Section>
    </Card>
  </div>

  <!-- Announcements -->
  <Card variant="surface" size="lg">
    <Section>
      {#snippet header()}
        <h2>站內公告</h2>
      {/snippet}
      {#if data.announcements.length > 0}
        <ul class="space-y-3">
          {#each data.announcements.slice(0, 5) as a (a.id)}
            <li class="rounded-lg border border-border-subtle px-3 py-2.5">
              <div class="flex items-baseline justify-between gap-3">
                <p class="min-w-0 flex-1 truncate text-body-sm font-semibold">
                  {#if a.pinned}
                    <span class="mr-1 text-warning">★</span>
                  {/if}
                  {a.title}
                </p>
                <span class="shrink-0 text-caption text-muted-foreground tabular-nums">
                  {new Date(a.createdAt).toLocaleDateString()}
                </span>
              </div>
              {#if a.content}
                <p class="mt-1 line-clamp-2 text-caption text-muted-foreground">
                  {a.content}
                </p>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <EmptyState variant="minimal" icon={Megaphone} title="目前沒有公告" />
      {/if}
    </Section>
  </Card>

  <!-- Recent activity -->
  <Card variant="surface" size="lg">
    <Section>
      {#snippet header()}
        <h2>{m.dashboard_recentActivity()}</h2>
      {/snippet}
      {#if data.recentSubmissions.length > 0}
        <ul class="space-y-3">
          {#each data.recentSubmissions as sub (sub.id)}
            <li class="flex items-center gap-3 text-body-sm">
              <time class="shrink-0 text-caption text-muted-foreground tabular-nums">
                {timeAgo(sub.createdAt)}
              </time>
              <Badge variant={verdictToBadgeVariant(sub.status)} size="sm">
                {formatVerdictLabel(sub.status)}
              </Badge>
              <a href="/problems/{sub.problem.id}" class="truncate hover:underline">
                {sub.problem.title}
              </a>
              <span class="shrink-0 text-caption text-muted-foreground">({sub.language})</span>
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
    </Section>
  </Card>

  <!-- Recommendations -->
  <Card variant="surface" size="lg">
    <Section>
      {#snippet header()}
        <h2>{m.dashboard_recommendations()}</h2>
      {/snippet}
      {#if data.recommendations.length > 0}
        <ul class="space-y-3">
          {#each data.recommendations as rec (rec.id)}
            <li class="flex flex-wrap items-center gap-2 text-body-sm">
              <a href="/problems/{rec.id}" class="font-medium hover:underline">
                {rec.title}
              </a>
              {#each rec.tags as tag (tag)}
                <Badge variant="muted" size="xs">#{tag}</Badge>
              {/each}
            </li>
          {/each}
        </ul>
      {:else}
        <EmptyState
          variant="minimal"
          icon={Lightbulb}
          title={m.dashboard_noRecommendations()}
          description={m.dashboard_recommendationsEmptyDescription()}
        />
      {/if}
    </Section>
  </Card>
</div>
