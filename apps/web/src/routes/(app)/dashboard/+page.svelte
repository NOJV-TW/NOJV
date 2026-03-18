<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import EChart from "$lib/components/charts/EChart.svelte";
  import { difficultyColor, verdictColor, formatVerdictLabel } from "$lib/types";
  import type { DailyActivity, LanguageDist, DifficultyDist } from "@nojv/core";
  import type { EChartsOption } from "echarts";

  let { data } = $props();

  const stats = $derived(data.stats);

  const acRate = $derived(
    stats.totalAttempts > 0
      ? ((stats.totalAc / stats.totalAttempts) * 100).toFixed(1) + "%"
      : "0%"
  );

  // -- Activity line chart (last 30 days) --
  const activityOption: EChartsOption = $derived.by(() => {
    const raw = (stats.dailyActivity ?? []) as DailyActivity[];
    const dates = raw.map((d) => d.date);
    const counts = raw.map((d) => d.acCount);

    return {
      grid: { left: 40, right: 16, top: 16, bottom: 32 },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 11 } },
      yAxis: { type: "value", minInterval: 1, axisLabel: { fontSize: 11 } },
      series: [
        {
          type: "line",
          data: counts,
          smooth: true,
          areaStyle: { opacity: 0.15 },
          lineStyle: { width: 2 },
          itemStyle: { color: "#10b981" }
        }
      ],
      tooltip: { trigger: "axis" }
    };
  });

  // -- Language pie chart --
  const languageOption: EChartsOption = $derived.by(() => {
    const dist = (stats.languageDist ?? {}) as LanguageDist;
    const pieData = Object.entries(dist).map(([name, value]) => ({ name, value }));

    return {
      tooltip: { trigger: "item" },
      series: [
        {
          type: "pie",
          radius: ["35%", "65%"],
          data: pieData,
          label: { fontSize: 12 },
          emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: "rgba(0,0,0,0.2)" } }
        }
      ]
    };
  });

  // -- Difficulty bar chart --
  const difficultyOption: EChartsOption = $derived.by(() => {
    const dist = (stats.difficultyDist ?? {}) as DifficultyDist;
    const categories = ["easy", "medium", "hard"];
    const colors: Record<string, string> = { easy: "#10b981", medium: "#f59e0b", hard: "#ef4444" };
    const values = categories.map((c) => ({
      value: dist[c] ?? 0,
      itemStyle: { color: colors[c]! }
    }));

    return {
      grid: { left: 60, right: 16, top: 16, bottom: 24 },
      xAxis: { type: "value", minInterval: 1, axisLabel: { fontSize: 11 } },
      yAxis: { type: "category", data: categories, axisLabel: { fontSize: 12, formatter: (v: string) => v.charAt(0).toUpperCase() + v.slice(1) } },
      series: [{ type: "bar", data: values, barWidth: 20 }],
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }
    };
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
    {#if ((stats.dailyActivity ?? []) as Array<unknown>).length > 0}
      <EChart option={activityOption} class="mt-4 h-56 w-full" />
    {:else}
      <p class="mt-4 text-sm text-muted-foreground">{m.dashboard_noActivity()}</p>
    {/if}
  </div>

  <!-- Language & Difficulty charts -->
  <div class="grid gap-4 md:grid-cols-2">
    <div
      class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-5 backdrop-blur-sm"
    >
      <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
        {m.dashboard_languageDist()}
      </p>
      {#if Object.keys((stats.languageDist ?? {}) as Record<string, unknown>).length > 0}
        <EChart option={languageOption} class="mt-4 h-56 w-full" />
      {:else}
        <p class="mt-4 text-sm text-muted-foreground">{m.dashboard_noActivity()}</p>
      {/if}
    </div>
    <div
      class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-5 backdrop-blur-sm"
    >
      <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
        {m.dashboard_difficultyDist()}
      </p>
      {#if Object.keys((stats.difficultyDist ?? {}) as Record<string, unknown>).length > 0}
        <EChart option={difficultyOption} class="mt-4 h-56 w-full" />
      {:else}
        <p class="mt-4 text-sm text-muted-foreground">{m.dashboard_noActivity()}</p>
      {/if}
    </div>
  </div>

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
              href="/problems/{sub.problem.slug}"
              class="truncate hover:underline"
            >
              {sub.problem.defaultTitle}
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
        {#each data.recommendations as rec (rec.slug)}
          <li class="flex flex-wrap items-center gap-2 text-sm">
            <span
              class="rounded-full px-2.5 py-0.5 text-xs font-medium capitalize {difficultyColor[rec.difficulty] ?? 'bg-muted text-muted-foreground'}"
            >
              {rec.difficulty}
            </span>
            <a href="/problems/{rec.slug}" class="font-medium hover:underline">
              {rec.defaultTitle}
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
