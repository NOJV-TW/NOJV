<script lang="ts">
  import { browser } from "$app/environment";
  import {
    AlertTriangle,
    BarChart3,
    BookOpen,
    Bug,
    CheckCircle2,
    Database,
    Languages,
    PieChart,
    ShieldCheck,
    Trophy,
    Users
  } from "@lucide/svelte";
  import EChart from "$lib/components/primitives/charts/EChart.svelte";
  import type { EChartsOption } from "echarts";
  import { onMount } from "svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import StatCard from "$lib/components/primitives/ui/StatCard.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { m } from "$lib/paraglide/messages.js";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  type UiLang = "zh" | "en";
  let uiLang = $state<UiLang>("zh");

  const text = {
    en: {
      accepted: "Accepted",
      acceptedRate7d: "Submission quality (7d)",
      admin: "Admin",
      avg: "avg",
      connected: "Connected",
      coursesAssets: "Learning assets",
      coursesLabel: "courses",
      database: "Database",
      delayed: "delayed",
      disabled: "disabled",
      disconnected: "Disconnected",
      english: "English",
      events: "Events",
      failed: "failed",
      health: "System Health",
      healthSubtitle: "Database availability check",
      last14d: "Last 14 days",
      noRecentErrors: "No recent error submissions.",
      noTopFail: "No compile/runtime type failures in last 7 days.",
      overview: "Admin Overview",
      overviewSubtitle: "Global operational visibility across users, courses, submissions, and infrastructure.",
      problem: "Problem",
      problemsLabel: "public problems",
      queue: "Submission queue",
      queueSnapshot: "Queue snapshot",
      recentErrors: "Recent Error Submissions",
      roleSubtitle: "Distribution of platform roles",
      status: "Status",
      statusDist: "Submission status distribution",
      statusSubtitle: "Past 7-day verdict composition",
      student: "Student",
      submissionsIn7d: "submissions in last 7 days",
      submissionTrend: "Submission Trend",
      systemText: "System Text",
      teacher: "Teacher",
      time: "Time",
      topFailing: "Top Failing Problems (7d)",
      unavailable: "Unavailable",
      users: "Users",
      userRoleDist: "User role distribution",
      zh: "中文"
    },
    zh: {
      accepted: "通過",
      acceptedRate7d: "提交品質（7天）",
      admin: "管理員",
      avg: "平均",
      connected: "連線正常",
      coursesAssets: "教學資產",
      coursesLabel: "課程",
      database: "資料庫",
      delayed: "延遲",
      disabled: "停用",
      disconnected: "連線失敗",
      english: "English",
      events: "活動數量",
      failed: "失敗",
      health: "系統健康",
      healthSubtitle: "資料庫 / 佇列可用性與佇列快照",
      last14d: "最近 14 天",
      noRecentErrors: "目前沒有近期錯誤提交。",
      noTopFail: "最近 7 天沒有編譯/執行類型錯誤熱點。",
      overview: "管理總覽",
      overviewSubtitle: "從使用者、課程、提交到基礎設施的全域營運可視化。",
      problem: "題目",
      problemsLabel: "公開題目",
      queue: "提交佇列",
      queueSnapshot: "佇列快照",
      recentErrors: "近期錯誤提交",
      roleSubtitle: "平台角色分布",
      status: "狀態",
      statusDist: "提交狀態分布",
      statusSubtitle: "近 7 天判題結果組成",
      student: "學生",
      submissionsIn7d: "最近 7 天提交",
      submissionTrend: "提交趨勢",
      systemText: "系統文字",
      teacher: "教師",
      time: "時間",
      topFailing: "高錯誤題目（7天）",
      unavailable: "無法連線",
      users: "使用者",
      userRoleDist: "使用者角色分布",
      zh: "中文"
    }
  } as const;

  function t<K extends keyof (typeof text)["en"]>(key: K): string {
    return text[uiLang][key];
  }

  onMount(() => {
    if (!browser) return;
    const saved = localStorage.getItem("nojv-system-text-lang");
    if (saved === "zh" || saved === "en") {
      uiLang = saved;
    }
  });

  function setUiLang(next: UiLang): void {
    uiLang = next;
    if (browser) {
      localStorage.setItem("nojv-system-text-lang", next);
    }
  }

  const roleOption: EChartsOption = $derived.by(() => ({
    grid: { left: 32, right: 16, top: 20, bottom: 28 },
    xAxis: {
      type: "category",
      data: [t("admin"), t("teacher"), t("student")]
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
          color: (params: { dataIndex: number }) => ["#f97316", "#3b82f6", "#10b981"][params.dataIndex] ?? "#6b7280"
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
        name: t("submissionTrend"),
        data: data.dailySeries.map((d: { total: number }) => d.total),
        smooth: true,
        itemStyle: { color: "#3b82f6" }
      },
      {
        type: "line",
        name: t("accepted"),
        data: data.dailySeries.map((d: { accepted: number }) => d.accepted),
        smooth: true,
        areaStyle: { opacity: 0.15 },
        itemStyle: { color: "#10b981" }
      }
    ]
  }));

</script>

{#snippet langToggle()}
  <div class="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-muted/30 p-1">
    <span class="inline-flex items-center gap-1 px-2 text-caption text-muted-foreground">
      <Languages class="h-3.5 w-3.5" />
      {t("systemText")}
    </span>
    <button
      type="button"
      class="min-h-9 rounded-full px-3 py-1 text-caption font-medium transition-colors duration-fast ease-out-soft {uiLang === 'zh' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => setUiLang("zh")}
    >
      {t("zh")}
    </button>
    <button
      type="button"
      class="min-h-9 rounded-full px-3 py-1 text-caption font-medium transition-colors duration-fast ease-out-soft {uiLang === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => setUiLang("en")}
    >
      {t("english")}
    </button>
  </div>
{/snippet}

<PageHeader
  eyebrow={m.admin_eyebrow()}
  title={t("overview")}
  description={t("overviewSubtitle")}
  actions={langToggle}
/>

<div class="space-y-6">
  <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <StatCard
      label={t("users")}
      value={data.kpi.totalUsers}
      icon={Users}
    />
    <StatCard
      label={t("coursesAssets")}
      value={data.kpi.totalCourses}
      icon={BookOpen}
    />
    <StatCard
      label={t("events")}
      value={data.kpi.totalContests + data.kpi.totalAssignments}
      icon={Trophy}
    />
    <StatCard
      label={t("acceptedRate7d")}
      value={`${data.kpi.acceptedRate7d}%`}
      icon={CheckCircle2}
    />
  </section>

  <section class="grid gap-4 xl:grid-cols-3">
    <Card variant="surface" size="md" class="xl:col-span-2">
      <div class="flex items-center justify-between">
        <h2 class="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
          <BarChart3 class="h-3.5 w-3.5" /> {t("submissionTrend")}
        </h2>
        <span class="text-caption text-muted-foreground">{t("last14d")}</span>
      </div>
      <EChart option={dailyOption} class="h-70 w-full" />
    </Card>

    <Card variant="surface" size="md">
      <div>
        <h2 class="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
          <ShieldCheck class="h-3.5 w-3.5" /> {t("health")}
        </h2>
        <p class="mt-1 text-caption text-muted-foreground">{t("healthSubtitle")}</p>
      </div>
      <div class="space-y-2 text-body-sm">
        <div class="flex items-center justify-between rounded-sm border border-border-subtle px-3 py-2">
          <span class="inline-flex items-center gap-1"><Database class="h-3.5 w-3.5" /> {t("database")}</span>
          {#if data.dbOk}
            <Badge variant="success" size="sm" dot>{t("connected")}</Badge>
          {:else}
            <Badge variant="destructive" size="sm" dot>{t("disconnected")}</Badge>
          {/if}
        </div>
      </div>
    </Card>
  </section>

  <section class="grid gap-4 xl:grid-cols-2">
    <Card variant="surface" size="md">
      <div>
        <h2 class="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
          <Users class="h-3.5 w-3.5" /> {t("userRoleDist")}
        </h2>
        <p class="mt-1 text-caption text-muted-foreground">{t("roleSubtitle")}</p>
      </div>
      <EChart option={roleOption} class="h-60 w-full" />
    </Card>

    <Card variant="surface" size="md">
      <div>
        <h2 class="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
          <PieChart class="h-3.5 w-3.5" /> {t("statusDist")}
        </h2>
        <p class="mt-1 text-caption text-muted-foreground">{t("statusSubtitle")}</p>
      </div>
      <EChart option={statusOption} class="h-60 w-full" />
    </Card>
  </section>

  <section class="grid gap-4 xl:grid-cols-2">
    <Card variant="surface" size="md">
      <h2 class="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
        <AlertTriangle class="h-3.5 w-3.5" /> {t("topFailing")}
      </h2>
      {#if data.topFailingProblems.length === 0}
        <p class="text-body-sm text-muted-foreground">{t("noTopFail")}</p>
      {:else}
        <ul class="space-y-2">
          {#each data.topFailingProblems as row (row.problemId)}
            <li class="rounded-sm border border-border-subtle px-3 py-2 text-body-sm">
              <div class="flex items-center justify-between gap-3">
                <a class="truncate font-medium hover:underline" href="/problems/{row.id}">
                  {row.title}
                </a>
                <span class="shrink-0 text-caption text-muted-foreground">{row.errorCount} errors</span>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </Card>

    <Card variant="surface" size="md">
      <h2 class="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
        <Bug class="h-3.5 w-3.5" /> {t("recentErrors")}
      </h2>
      {#if data.recentErrors.length === 0}
        <p class="text-body-sm text-muted-foreground">{t("noRecentErrors")}</p>
      {:else}
        <div class="max-h-92 overflow-auto rounded-sm border border-border-subtle">
          <table class="w-full text-body-sm">
            <thead>
              <tr class="border-b border-border-subtle bg-muted/40 text-left text-caption uppercase tracking-wider text-muted-foreground">
                <th class="px-3 py-2 font-medium">{t("time")}</th>
                <th class="px-3 py-2 font-medium">{t("problem")}</th>
                <th class="px-3 py-2 font-medium">{t("users")}</th>
                <th class="px-3 py-2 font-medium">{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {#each data.recentErrors as row (row.id)}
                <tr class="border-b border-border-subtle last:border-b-0">
                  <td class="px-3 py-2 text-caption text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</td>
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
