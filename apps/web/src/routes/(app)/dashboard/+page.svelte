<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { Code2, Lightbulb, LineChart } from "@lucide/svelte";
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

  // The Phase 1 redesign moved daily activity into its own table
  // (`UserDailyActivity`) and dropped the JSON `languageDist` /
  // `difficultyDist` blobs from `UserStats`. The activity chart still
  // works because the server-side load now reads from the new table.
  // The language + difficulty pies are TODO: a follow-up should add a
  // domain helper to compute these histograms on demand from the
  // `Submission` and `Problem` tables.
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

  <!--
    TODO(phase-5-followup): the language + difficulty pies were removed
    when `UserStats.languageDist` / `difficultyDist` JSON blobs were
    dropped in the Phase 1 redesign. They can be re-added once the
    domain layer exposes histogram queries that compute them on demand
    from the Submission + Problem tables.
  -->

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
