<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import EChart from "$lib/components/charts/EChart.svelte";
  import { verdictColor, formatVerdictLabel } from "$lib/types";
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
        itemStyle: { color: "#10b981" }
      }
    ],
    tooltip: { trigger: "axis" }
  });

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
  <h2 class="font-[family-name:var(--font-display)] text-3xl">
    {m.dashboard_welcome({ username: data.username })}
  </h2>

  <!-- Stats cards -->
  <div class="grid gap-4 sm:grid-cols-3">
    <div
      class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-5 backdrop-blur-sm"
    >
      <p class="text-sm text-muted-foreground">{m.dashboard_totalAc()}</p>
      <p class="mt-1 text-3xl font-semibold">{stats.totalAc}</p>
    </div>
    <div
      class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-5 backdrop-blur-sm"
    >
      <p class="text-sm text-muted-foreground">{m.dashboard_totalAttempts()}</p>
      <p class="mt-1 text-3xl font-semibold">{stats.totalAttempts}</p>
    </div>
    <div
      class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-5 backdrop-blur-sm"
    >
      <p class="text-sm text-muted-foreground">{m.dashboard_acRate()}</p>
      <p class="mt-1 text-3xl font-semibold">{acRate}</p>
    </div>
  </div>

  <!-- Activity chart -->
  <div
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-5 backdrop-blur-sm"
  >
    <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
      {m.dashboard_activityChart()}
    </p>
    {#if hasActivity}
      <EChart option={activityOption} class="mt-4 h-56 w-full" />
    {:else}
      <p class="mt-4 text-sm text-muted-foreground">{m.dashboard_noActivity()}</p>
    {/if}
  </div>

  <!--
    TODO(phase-5-followup): the language + difficulty pies were removed
    when `UserStats.languageDist` / `difficultyDist` JSON blobs were
    dropped in the Phase 1 redesign. They can be re-added once the
    domain layer exposes histogram queries that compute them on demand
    from the Submission + Problem tables.
  -->


  <!-- Recent activity -->
  <div
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-5 backdrop-blur-sm"
  >
    <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
      {m.dashboard_recentActivity()}
    </p>
    {#if data.recentSubmissions.length > 0}
      <ul class="mt-4 space-y-3">
        {#each data.recentSubmissions as sub (sub.id)}
          <li class="flex items-center gap-3 text-sm">
            <span class="shrink-0 text-xs text-muted-foreground">{timeAgo(sub.createdAt)}</span>
            <span class="shrink-0 font-semibold {verdictColor[sub.status] ?? 'text-muted-foreground'}">
              {formatVerdictLabel(sub.status)}
            </span>
            <a
              href="/problems/{sub.problem.id}"
              class="truncate hover:underline"
            >
              {sub.problem.title}
            </a>
            <span class="shrink-0 text-xs text-muted-foreground">({sub.language})</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="mt-4 text-sm text-muted-foreground">{m.dashboard_noActivity()}</p>
    {/if}
  </div>

  <!-- Recommendations -->
  <div
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-5 backdrop-blur-sm"
  >
    <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
      {m.dashboard_recommendations()}
    </p>
    {#if data.recommendations.length > 0}
      <ul class="mt-4 space-y-3">
        {#each data.recommendations as rec (rec.id)}
          <li class="flex flex-wrap items-center gap-2 text-sm">
            <a href="/problems/{rec.id}" class="font-medium hover:underline">
              {rec.title}
            </a>
            {#each rec.tags as tag (tag)}
              <span class="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                #{tag}
              </span>
            {/each}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="mt-4 text-sm text-muted-foreground">{m.dashboard_noRecommendations()}</p>
    {/if}
  </div>
</div>
