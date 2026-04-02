<script lang="ts">
  import { browser } from "$app/environment";
  import {
    Activity,
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
    UserCog,
    Users
  } from "@lucide/svelte";
  import EChart from "$lib/components/charts/EChart.svelte";
  import type { EChartsOption } from "echarts";
  import { onMount } from "svelte";

  let { data }: { data: any } = $props();

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
      roleMix: "Role mix quick view",
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
      roleMix: "角色比例速覽",
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

  function pct(value: number, total: number): string {
    if (total <= 0) return "0%";
    return `${Math.round((value / total) * 100)}%`;
  }
</script>

<div class="space-y-6">
  <section class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="inline-flex items-center gap-2 text-xl font-semibold">
          <Activity class="h-4 w-4 text-muted-foreground" />
          {t("overview")}
        </h2>
        <p class="mt-1 text-sm text-muted-foreground">{t("overviewSubtitle")}</p>
      </div>
      <div class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 p-1">
        <span class="inline-flex items-center gap-1 px-2 text-xs text-muted-foreground">
          <Languages class="h-3.5 w-3.5" />
          {t("systemText")}
        </span>
        <button
          type="button"
          class="rounded-full px-3 py-1 text-xs font-medium {uiLang === 'zh' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}"
          onclick={() => setUiLang("zh")}
        >
          {t("zh")}
        </button>
        <button
          type="button"
          class="rounded-full px-3 py-1 text-xs font-medium {uiLang === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}"
          onclick={() => setUiLang("en")}
        >
          {t("english")}
        </button>
      </div>
    </div>
  </section>

  <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
      <p class="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
        <Users class="h-3.5 w-3.5" /> {t("users")}
      </p>
      <p class="mt-1 text-2xl font-semibold">{data.kpi.totalUsers}</p>
      <p class="text-xs text-muted-foreground">{data.kpi.disabledUsers} {t("disabled")}</p>
    </div>
    <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
      <p class="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
        <BookOpen class="h-3.5 w-3.5" /> {t("coursesAssets")}
      </p>
      <p class="mt-1 text-2xl font-semibold">{data.kpi.totalCourses}</p>
      <p class="text-xs text-muted-foreground">{t("coursesLabel")} / {data.kpi.totalProblems} {t("problemsLabel")}</p>
    </div>
    <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
      <p class="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
        <Trophy class="h-3.5 w-3.5" /> {t("events")}
      </p>
      <p class="mt-1 text-2xl font-semibold">{data.kpi.totalAssessments}</p>
      <p class="text-xs text-muted-foreground">assessments / {data.kpi.totalContests} contests</p>
    </div>
    <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
      <p class="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
        <CheckCircle2 class="h-3.5 w-3.5" /> {t("acceptedRate7d")}
      </p>
      <p class="mt-1 text-2xl font-semibold">{data.kpi.acceptedRate7d}%</p>
      <p class="text-xs text-muted-foreground">{data.kpi.submissions7dTotal} {t("submissionsIn7d")}</p>
    </div>
  </section>

  <section class="grid gap-4 xl:grid-cols-3">
    <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-4 xl:col-span-2">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="inline-flex items-center gap-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <BarChart3 class="h-3.5 w-3.5" /> {t("submissionTrend")}
        </h2>
        <span class="text-xs text-muted-foreground">{t("last14d")}</span>
      </div>
      <EChart option={dailyOption} class="h-70 w-full" />
    </div>

    <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
      <h2 class="inline-flex items-center gap-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <ShieldCheck class="h-3.5 w-3.5" /> {t("health")}
      </h2>
      <p class="mt-1 text-xs text-muted-foreground">{t("healthSubtitle")}</p>
      <div class="mt-3 space-y-2 text-sm">
        <div class="flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <span class="inline-flex items-center gap-1"><Database class="h-3.5 w-3.5" /> {t("database")}</span>
          <span class={data.dbOk ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
            {data.dbOk ? t("connected") : t("disconnected")}
          </span>
        </div>
      </div>
    </div>
  </section>

  <section class="grid gap-4 xl:grid-cols-2">
    <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
      <h2 class="inline-flex items-center gap-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <Users class="h-3.5 w-3.5" /> {t("userRoleDist")}
      </h2>
      <p class="mt-1 text-xs text-muted-foreground">{t("roleSubtitle")}</p>
      <EChart option={roleOption} class="mt-2 h-60 w-full" />
    </div>

    <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
      <h2 class="inline-flex items-center gap-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <PieChart class="h-3.5 w-3.5" /> {t("statusDist")}
      </h2>
      <p class="mt-1 text-xs text-muted-foreground">{t("statusSubtitle")}</p>
      <EChart option={statusOption} class="mt-2 h-60 w-full" />
    </div>
  </section>

  <section class="grid gap-4 xl:grid-cols-2">
    <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
      <h2 class="inline-flex items-center gap-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <AlertTriangle class="h-3.5 w-3.5" /> {t("topFailing")}
      </h2>
      {#if data.topFailingProblems.length === 0}
        <p class="mt-3 text-sm text-muted-foreground">{t("noTopFail")}</p>
      {:else}
        <ul class="mt-3 space-y-2">
          {#each data.topFailingProblems as row (row.problemId)}
            <li class="rounded-lg border border-border px-3 py-2 text-sm">
              <div class="flex items-center justify-between gap-3">
                <a class="truncate font-medium hover:underline" href="/problems/{row.slug}">
                  {row.title}
                </a>
                <span class="shrink-0 text-xs text-muted-foreground">{row.errorCount} errors</span>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
      <h2 class="inline-flex items-center gap-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <Bug class="h-3.5 w-3.5" /> {t("recentErrors")}
      </h2>
      {#if data.recentErrors.length === 0}
        <p class="mt-3 text-sm text-muted-foreground">{t("noRecentErrors")}</p>
      {:else}
        <div class="mt-3 max-h-92 overflow-auto rounded-lg border border-border">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th class="px-3 py-2">{t("time")}</th>
                <th class="px-3 py-2">{t("problem")}</th>
                <th class="px-3 py-2">{t("users")}</th>
                <th class="px-3 py-2">{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {#each data.recentErrors as row (row.id)}
                <tr class="border-b border-border last:border-b-0">
                  <td class="px-3 py-2 text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</td>
                  <td class="px-3 py-2">
                    <a class="hover:underline" href="/problems/{row.problem.slug}">{row.problem.defaultTitle}</a>
                  </td>
                  <td class="px-3 py-2 text-xs">{row.user.username ?? row.user.name}</td>
                  <td class="px-3 py-2 text-xs">
                    <span class="rounded px-1.5 py-0.5 {row.status === 'runtime_error' ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}">
                      {row.status.replaceAll("_", " ")}
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </section>

  <section class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
    <h2 class="inline-flex items-center gap-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
      <UserCog class="h-3.5 w-3.5" /> {t("roleMix")}
    </h2>
    <div class="mt-3 grid gap-3 sm:grid-cols-3">
      <div class="rounded-lg border border-border px-3 py-3">
        <p class="text-xs uppercase tracking-wider text-muted-foreground">{t("admin")}</p>
        <p class="mt-1 text-xl font-semibold">{data.roleCounts.admin}</p>
        <p class="text-xs text-muted-foreground">{pct(data.roleCounts.admin, data.kpi.totalUsers)}</p>
      </div>
      <div class="rounded-lg border border-border px-3 py-3">
        <p class="text-xs uppercase tracking-wider text-muted-foreground">{t("teacher")}</p>
        <p class="mt-1 text-xl font-semibold">{data.roleCounts.teacher}</p>
        <p class="text-xs text-muted-foreground">{pct(data.roleCounts.teacher, data.kpi.totalUsers)}</p>
      </div>
      <div class="rounded-lg border border-border px-3 py-3">
        <p class="text-xs uppercase tracking-wider text-muted-foreground">{t("student")}</p>
        <p class="mt-1 text-xl font-semibold">{data.roleCounts.student}</p>
        <p class="text-xs text-muted-foreground">{pct(data.roleCounts.student, data.kpi.totalUsers)}</p>
      </div>
    </div>
  </section>
</div>
