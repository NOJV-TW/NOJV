<script lang="ts">
  import {
    AlertTriangle,
    BarChart3,
    BookOpen,
    Bug,
    CheckCircle2,
    Database,
    PieChart,
    ShieldCheck,
    Trophy,
    Users
  } from "@lucide/svelte";
  import EChart from "$lib/components/primitives/charts/EChart.svelte";
  import type { EChartsOption } from "echarts";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import StatCard from "$lib/components/primitives/ui/StatCard.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { m } from "$lib/paraglide/messages.js";
  import { formatDateTime } from "$lib/utils/datetime";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const DEFAULT_THEME_COLORS = {
    chart1: "#c4682d",
    chart2: "#4d6f8f",
    chart3: "#8a6142",
    success: "#7a8f6d",
    mutedFg: "#6b7280"
  };
  let themeColors = $state({ ...DEFAULT_THEME_COLORS });

  function resolveThemeColors() {
    if (typeof window === "undefined") return;
    const cs = getComputedStyle(document.documentElement);
    const read = (n: string, fallback: string) => cs.getPropertyValue(n).trim() || fallback;
    themeColors = {
      chart1: read("--chart-1", DEFAULT_THEME_COLORS.chart1),
      chart2: read("--chart-2", DEFAULT_THEME_COLORS.chart2),
      chart3: read("--chart-3", DEFAULT_THEME_COLORS.chart3),
      success: read("--success", DEFAULT_THEME_COLORS.success),
      mutedFg: read("--muted-foreground", DEFAULT_THEME_COLORS.mutedFg)
    };
  }

  $effect(() => {
    resolveThemeColors();
    const observer = new MutationObserver(resolveThemeColors);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"]
    });
    return () => observer.disconnect();
  });

  const roleOption: EChartsOption = $derived.by(() => ({
    grid: { left: 32, right: 16, top: 20, bottom: 28 },
    xAxis: {
      type: "category",
      data: [m.admin_overviewRoleAdmin(), m.admin_overviewRoleTeacher(), m.admin_overviewRoleStudent()]
    },
    yAxis: {
      type: "value",
      minInterval: 1
    },
    tooltip: { trigger: "axis" },
    series: [
      {
        type: "bar",
        data: [data.roleCounts.admin, data.roleCounts.teacher, data.roleCounts.student],
        itemStyle: {
          color: (params: { dataIndex: number }) =>
            [themeColors.chart1, themeColors.chart2, themeColors.chart3][params.dataIndex] ??
            themeColors.mutedFg
        },
        barMaxWidth: 38
      }
    ]
  }));

  const statusOption: EChartsOption = $derived.by(() => ({
    tooltip: { trigger: "item" },
    legend: { bottom: 0 },
    series: [
      {
        type: "pie",
        radius: ["42%", "68%"],
        data: data.statusBreakdown.map((entry: { name: string; value: number }) => ({
          name: entry.name.replaceAll("_", " "),
          value: entry.value
        }))
      }
    ]
  }));

  const dailyOption: EChartsOption = $derived.by(() => ({
    grid: { left: 40, right: 16, top: 24, bottom: 36 },
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    xAxis: {
      type: "category",
      data: data.dailySeries.map((d: { label: string }) => d.label)
    },
    yAxis: {
      type: "value",
      minInterval: 1
    },
    series: [
      {
        type: "line",
        name: m.admin_overviewSubmissionTrend(),
        data: data.dailySeries.map((d: { total: number }) => d.total),
        smooth: true,
        itemStyle: { color: themeColors.chart2 }
      },
      {
        type: "line",
        name: m.admin_overviewAccepted(),
        data: data.dailySeries.map((d: { accepted: number }) => d.accepted),
        smooth: true,
        areaStyle: { opacity: 0.15 },
        itemStyle: { color: themeColors.success }
      }
    ]
  }));
</script>

<PageHeader
  eyebrow={m.admin_eyebrow()}
  title={m.admin_overviewTitle()}
  description={m.admin_overviewSubtitle()}
/>

<div class="space-y-6">
  <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <StatCard
      label={m.admin_overviewUsers()}
      value={data.kpi.totalUsers}
      icon={Users}
    />
    <StatCard
      label={m.admin_overviewCoursesAssets()}
      value={data.kpi.totalCourses}
      icon={BookOpen}
    />
    <StatCard
      label={m.admin_overviewEvents()}
      value={data.kpi.totalContests + data.kpi.totalAssignments}
      icon={Trophy}
    />
    <StatCard
      label={m.admin_overviewAcceptedRate7d()}
      value={`${data.kpi.acceptedRate7d}%`}
      icon={CheckCircle2}
    />
  </section>

  <section class="grid gap-4 xl:grid-cols-3">
    <Card variant="surface" size="md" class="xl:col-span-2">
      <div class="flex items-center justify-between">
        <h2 class="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
          <BarChart3 aria-hidden="true" class="h-3.5 w-3.5" /> {m.admin_overviewSubmissionTrend()}
        </h2>
        <span class="text-caption text-muted-foreground">{m.admin_overviewLast14d()}</span>
      </div>
      <EChart option={dailyOption} class="h-70 w-full" />
    </Card>

    <Card variant="surface" size="md">
      <div>
        <h2 class="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
          <ShieldCheck aria-hidden="true" class="h-3.5 w-3.5" /> {m.admin_overviewHealth()}
        </h2>
        <p class="mt-1 text-caption text-muted-foreground">{m.admin_overviewHealthSubtitle()}</p>
      </div>
      <div class="space-y-2 text-body-sm">
        <div class="flex items-center justify-between rounded-sm border border-border-subtle px-3 py-2">
          <span class="inline-flex items-center gap-1"><Database aria-hidden="true" class="h-3.5 w-3.5" /> {m.admin_overviewDatabase()}</span>
          {#if data.dbOk}
            <Badge variant="success" size="sm" dot>{m.admin_overviewConnected()}</Badge>
          {:else}
            <Badge variant="destructive" size="sm" dot>{m.admin_overviewDisconnected()}</Badge>
          {/if}
        </div>
      </div>
    </Card>
  </section>

  <section class="grid gap-4 xl:grid-cols-2">
    <Card variant="surface" size="md">
      <div>
        <h2 class="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
          <Users aria-hidden="true" class="h-3.5 w-3.5" /> {m.admin_overviewUserRoleDist()}
        </h2>
        <p class="mt-1 text-caption text-muted-foreground">{m.admin_overviewRoleSubtitle()}</p>
      </div>
      <EChart option={roleOption} class="h-60 w-full" />
    </Card>

    <Card variant="surface" size="md">
      <div>
        <h2 class="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
          <PieChart aria-hidden="true" class="h-3.5 w-3.5" /> {m.admin_overviewStatusDist()}
        </h2>
        <p class="mt-1 text-caption text-muted-foreground">{m.admin_overviewStatusSubtitle()}</p>
      </div>
      <EChart option={statusOption} class="h-60 w-full" />
    </Card>
  </section>

  <section class="grid gap-4 xl:grid-cols-2">
    <Card variant="surface" size="md">
      <h2 class="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
        <AlertTriangle aria-hidden="true" class="h-3.5 w-3.5" /> {m.admin_overviewTopFailing()}
      </h2>
      {#if data.topFailingProblems.length === 0}
        <p class="text-body-sm text-muted-foreground">{m.admin_overviewNoTopFail()}</p>
      {:else}
        <ul class="space-y-2">
          {#each data.topFailingProblems as row (row.problemId)}
            <li class="rounded-sm border border-border-subtle px-3 py-2 text-body-sm">
              <div class="flex items-center justify-between gap-3">
                <a class="truncate font-medium hover:underline" href="/problems/{row.id}">
                  {row.title}
                </a>
                <span class="shrink-0 text-caption text-muted-foreground">
                  {m.admin_overviewErrorCount({ count: row.errorCount })}
                </span>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </Card>

    <Card variant="surface" size="md">
      <h2 class="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
        <Bug aria-hidden="true" class="h-3.5 w-3.5" /> {m.admin_overviewRecentErrors()}
      </h2>
      {#if data.recentErrors.length === 0}
        <p class="text-body-sm text-muted-foreground">{m.admin_overviewNoRecentErrors()}</p>
      {:else}
        <div class="max-h-92 overflow-auto rounded-sm border border-border-subtle">
          <table class="w-full text-body-sm">
            <thead>
              <tr class="border-b border-border-subtle bg-muted/40 text-left text-caption uppercase tracking-wider text-muted-foreground">
                <th class="px-3 py-2 font-medium">{m.admin_overviewTime()}</th>
                <th class="px-3 py-2 font-medium">{m.admin_overviewProblem()}</th>
                <th class="px-3 py-2 font-medium">{m.admin_overviewUsers()}</th>
                <th class="px-3 py-2 font-medium">{m.admin_overviewStatus()}</th>
              </tr>
            </thead>
            <tbody>
              {#each data.recentErrors as row (row.id)}
                <tr class="border-b border-border-subtle last:border-b-0">
                  <td class="px-3 py-2 text-caption text-muted-foreground">{formatDateTime(row.createdAt)}</td>
                  <td class="px-3 py-2">
                    <a class="hover:underline" href="/problems/{row.problem.id}">{formatProblemDisplayName(row.problem)}</a>
                  </td>
                  <td class="px-3 py-2 text-caption">{row.user.username ?? row.user.name}</td>
                  <td class="px-3 py-2">
                    {#if row.status === "runtime_error"}
                      <Badge variant="verdict-re" size="xs">{row.status.replaceAll("_", " ")}</Badge>
                    {:else}
                      <Badge variant="warning" size="xs">{row.status.replaceAll("_", " ")}</Badge>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Card>
  </section>
</div>
