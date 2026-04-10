<script lang="ts">
  import { browser } from "$app/environment";
  import {
    BarChart3,
    BookOpen,
    ClipboardList,
    Gauge,
    Languages,
    LayoutDashboard,
    Medal,
    PieChart,
    ShieldAlert,
    Users
  } from "@lucide/svelte";
  import EChart from "$lib/components/charts/EChart.svelte";
  import type { EChartsOption } from "echarts";
  import { onMount } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import StatCard from "$lib/components/ui/StatCard.svelte";

  let { data }: { data: any } = $props();
  let course = $derived(data.courseData.course);
  let problems = $derived(data.courseData.problems);
  let analytics = $derived(data.analytics);

  type UiLang = "zh" | "en";
  let uiLang = $state<UiLang>("zh");

  const text = {
    en: {
      acceptedStudentRate: "AC student rate",
      acceptedSubs: "Accepted subs",
      actions: "Actions",
      active: "active",
      assessment: "Assessment",
      assessmentDrilldown: "Assessment Drilldown",
      assessmentSettings: "Assessment settings",
      assessmentTrend: "Assessment trend",
      assessments: "Assessments",
      avgBestScore: "Avg best score",
      courseRuntime: "Course Runtime Analytics",
      dashboard: "Teacher Dashboard",
      english: "English",
      goMatrix: "Go to matrix detail",
      instructionalBody: "Use participation rate with AC student rate to find assessments where students submit but still cannot solve.",
      instructionalInsight: "Instructional insight",
      latestSubmit: "Latest submit",
      manageAssessments: "Manage Assessments",
      matrixView: "Matrix view",
      members: "Members",
      noAtRisk: "No at-risk signal right now.",
      noPublishedAssessments: "No published assessments yet.",
      noPublishedToAnalyze: "No published assessments to analyze.",
      noStudentSubmissions: "No student submissions yet.",
      noSubmissions: "No submissions yet.",
      openMatrix: "Open Student Progress Matrix",
      participants: "Participants",
      participationRate: "Participation rate",
      pendingJudge: "Pending judge",
      pendingJudgeDesc: "queued + compiling + running",
      problems: "Problems",
      studentAttention: "Students Needing Attention",
      studentAttentionDesc: "Students with no submissions or no accepted outcomes so far.",
      students: "Students",
      submissionQuality: "Submission quality",
      submissions: "Submissions",
      systemText: "System Text",
      topStudents: "Top students by best-score sum",
      updatedFromLive: "Updated from live submissions and latest published assessments.",
      verdictDistribution: "Submission verdict distribution",
      watchOnePlace: "Watch every assessment and student outcome in one place.",
      window: "Window",
      zh: "中文"
    },
    zh: {
      acceptedStudentRate: "通過學生率",
      acceptedSubs: "通過提交",
      actions: "操作",
      active: "進行中",
      assessment: "評量",
      assessmentDrilldown: "評量下鑽",
      assessmentSettings: "評量設定",
      assessmentTrend: "評量趨勢",
      assessments: "評量",
      avgBestScore: "平均最佳分數",
      courseRuntime: "課程執行分析",
      dashboard: "教師儀表板",
      english: "English",
      goMatrix: "前往矩陣明細",
      instructionalBody: "可用參與率搭配通過學生率，找出學生有提交但解不出的評量。",
      instructionalInsight: "教學洞察",
      latestSubmit: "最近提交",
      manageAssessments: "管理評量",
      matrixView: "矩陣檢視",
      members: "成員",
      noAtRisk: "目前沒有高風險訊號。",
      noPublishedAssessments: "目前尚無已發布評量。",
      noPublishedToAnalyze: "目前沒有可分析的已發布評量。",
      noStudentSubmissions: "目前尚無學生提交。",
      noSubmissions: "目前尚無提交。",
      openMatrix: "開啟學生進度矩陣",
      participants: "參與人數",
      participationRate: "參與率",
      pendingJudge: "待判題",
      pendingJudgeDesc: "排隊 + 編譯中 + 執行中",
      problems: "題目",
      studentAttention: "需關注學生",
      studentAttentionDesc: "尚未提交或尚未有通過結果的學生。",
      students: "學生",
      submissionQuality: "提交品質",
      submissions: "提交",
      systemText: "系統文字",
      topStudents: "最佳分數總和排行",
      updatedFromLive: "由即時提交與最新發布評量即時計算。",
      verdictDistribution: "提交結果分布",
      watchOnePlace: "在同一頁面掌握每次評量與學生結果。",
      window: "時間區間",
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

  const assessmentTrendOption: EChartsOption = $derived.by(() => ({
    grid: { left: 38, right: 20, top: 24, bottom: 48 },
    tooltip: { trigger: "axis" },
    legend: { bottom: 0 },
    xAxis: {
      type: "category",
      data: analytics.series.labels,
      axisLabel: {
        interval: 0,
        rotate: analytics.series.labels.length > 6 ? 22 : 0,
        fontSize: 11
      }
    },
    yAxis: { type: "value", minInterval: 1 },
    series: [
      {
        type: "bar",
        name: t("submissions"),
        data: analytics.series.submissionCounts,
        itemStyle: { color: "#3b82f6" },
        barMaxWidth: 28
      },
      {
        type: "line",
        name: t("participationRate"),
        data: analytics.series.participantRates,
        smooth: true,
        yAxisIndex: 0,
        itemStyle: { color: "#10b981" }
      },
      {
        type: "line",
        name: t("acceptedStudentRate"),
        data: analytics.series.acceptedRates,
        smooth: true,
        yAxisIndex: 0,
        itemStyle: { color: "#f97316" }
      }
    ]
  }));

  const statusOption: EChartsOption = $derived.by(() => ({
    tooltip: { trigger: "item" },
    legend: { bottom: 0 },
    series: [
      {
        name: t("verdictDistribution"),
        type: "pie",
        radius: ["40%", "67%"],
        label: { formatter: "{b}: {c}" },
        data: analytics.statusBreakdown.map((row: { name: string; value: number }) => ({
          name: row.name.replaceAll("_", " "),
          value: row.value
        }))
      }
    ]
  }));

  const leaderboardOption: EChartsOption = $derived.by(() => ({
    grid: { left: 88, right: 20, top: 20, bottom: 28 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "value", minInterval: 1 },
    yAxis: {
      type: "category",
      data: analytics.leaderboard.map((row: { username: string }) => row.username),
      axisLabel: { fontSize: 11 }
    },
    series: [
      {
        type: "bar",
        name: t("avgBestScore"),
        data: analytics.leaderboard.map((row: { totalScore: number }) => row.totalScore),
        barMaxWidth: 24,
        itemStyle: { color: "#6366f1" },
        label: {
          show: true,
          position: "right",
          formatter: ({ dataIndex }: { dataIndex: number }) => {
            const row = analytics.leaderboard[dataIndex];
            if (!row) return "";
            return `AC cells ${row.acceptedCells}`;
          }
        }
      }
    ]
  }));
</script>

<section
  class="rounded-3xl border border-border bg-[color:var(--color-panel-strong)] px-6 py-8 shadow-rest backdrop-blur-sm"
>
  <p class="text-body-sm uppercase tracking-[0.18em] text-muted-foreground">
    {t("dashboard")} / {course.slug}
  </p>
  <h2 class="mt-2 font-display text-title-lg">{course.title}</h2>
  <p class="mt-4 text-muted-foreground">{course.description}</p>
  <div class="mt-6 grid gap-4 sm:grid-cols-3">
    <StatCard label={t("members")} value={course.members.length} icon={Users} />
    <StatCard label={t("assessments")} value={course.assessments.length} icon={ClipboardList} />
    <StatCard label={t("problems")} value={problems.length} icon={BookOpen} />
  </div>

  <div class="mt-4 flex flex-wrap gap-2">
    <a
      href="/courses/{course.slug}/manage/progress"
      class="inline-flex items-center rounded-full border border-border bg-[color:var(--color-panel)] px-4 py-2 text-body-sm font-medium shadow-rest transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:shadow-hover"
    >
      {t("openMatrix")}
    </a>
    <a
      href="/courses/{course.slug}/manage/assessments"
      class="inline-flex items-center rounded-full border border-border bg-[color:var(--color-panel)] px-4 py-2 text-body-sm font-medium shadow-rest transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:shadow-hover"
    >
      {t("manageAssessments")}
    </a>
    <div class="ml-auto inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 p-1">
      <span class="inline-flex items-center gap-1 px-2 text-xs text-muted-foreground">
        <Languages class="h-3.5 w-3.5" /> {t("systemText")}
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

<section class="rounded-3xl border border-border bg-[color:var(--color-panel)] px-6 py-6 shadow-rest backdrop-blur-sm">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <p class="inline-flex items-center gap-1 text-caption uppercase tracking-[0.2em] text-muted-foreground">
        <LayoutDashboard class="h-3.5 w-3.5" /> {t("dashboard")}
      </p>
      <h3 class="mt-2 text-title font-semibold">{t("courseRuntime")}</h3>
      <p class="mt-1 text-body-sm text-muted-foreground">
        {t("watchOnePlace")}
      </p>
    </div>
    <p class="text-caption text-muted-foreground">
      {t("updatedFromLive")}
    </p>
  </div>

  <div class="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    <div class="rounded-xl border border-border-subtle px-4 py-3">
      <p class="inline-flex items-center gap-1 text-caption uppercase tracking-wider text-muted-foreground"><Users class="h-3.5 w-3.5" /> {t("students")}</p>
      <p class="mt-1 text-title font-semibold tabular-nums">{analytics.overview.totalStudents}</p>
      <p class="text-caption text-muted-foreground tabular-nums">{t("participationRate")} {analytics.overview.participationRate}%</p>
    </div>
    <div class="rounded-xl border border-border-subtle px-4 py-3">
      <p class="inline-flex items-center gap-1 text-caption uppercase tracking-wider text-muted-foreground"><ClipboardList class="h-3.5 w-3.5" /> {t("assessments")}</p>
      <p class="mt-1 text-title font-semibold tabular-nums">{analytics.overview.totalAssessments}</p>
      <p class="text-caption text-muted-foreground tabular-nums">{analytics.overview.activeAssessments} {t("active")}</p>
    </div>
    <div class="rounded-xl border border-border-subtle px-4 py-3">
      <p class="inline-flex items-center gap-1 text-caption uppercase tracking-wider text-muted-foreground"><Gauge class="h-3.5 w-3.5" /> {t("submissionQuality")}</p>
      <p class="mt-1 text-title font-semibold tabular-nums">{analytics.overview.acceptedRate}%</p>
      <p class="text-caption text-muted-foreground tabular-nums">{analytics.overview.totalSubmissions} {t("submissions")}</p>
    </div>
    <div class="rounded-xl border border-border-subtle px-4 py-3">
      <p class="inline-flex items-center gap-1 text-caption uppercase tracking-wider text-muted-foreground"><ShieldAlert class="h-3.5 w-3.5" /> {t("pendingJudge")}</p>
      <p class="mt-1 text-title font-semibold tabular-nums">{analytics.overview.pendingJudgeCount}</p>
      <p class="text-caption text-muted-foreground">{t("pendingJudgeDesc")}</p>
    </div>
    <div class="rounded-xl border border-border-subtle px-4 py-3 sm:col-span-2 xl:col-span-2">
      <p class="text-caption uppercase tracking-wider text-muted-foreground">{t("instructionalInsight")}</p>
      <p class="mt-1 text-body-sm text-muted-foreground">
        {t("instructionalBody")}
      </p>
    </div>
  </div>

  <div class="mt-6 grid gap-4 xl:grid-cols-2">
    <div class="rounded-xl border border-border-subtle px-4 py-4">
      <h4 class="inline-flex items-center gap-1 text-body-sm font-semibold text-muted-foreground"><BarChart3 class="h-3.5 w-3.5" /> {t("assessmentTrend")}</h4>
      {#if analytics.series.labels.length > 0}
        <EChart option={assessmentTrendOption} class="mt-2 h-72 w-full" />
      {:else}
        <p class="mt-3 text-body-sm text-muted-foreground">{t("noPublishedAssessments")}</p>
      {/if}
    </div>

    <div class="rounded-xl border border-border-subtle px-4 py-4">
      <h4 class="inline-flex items-center gap-1 text-body-sm font-semibold text-muted-foreground"><PieChart class="h-3.5 w-3.5" /> {t("verdictDistribution")}</h4>
      {#if analytics.statusBreakdown.length > 0}
        <EChart option={statusOption} class="mt-2 h-72 w-full" />
      {:else}
        <p class="mt-3 text-body-sm text-muted-foreground">{t("noSubmissions")}</p>
      {/if}
    </div>
  </div>

  <div class="mt-4 rounded-xl border border-border-subtle px-4 py-4">
    <h4 class="inline-flex items-center gap-1 text-body-sm font-semibold text-muted-foreground"><Medal class="h-3.5 w-3.5" /> {t("topStudents")}</h4>
    {#if analytics.leaderboard.length > 0}
      <EChart option={leaderboardOption} class="mt-2 h-72 w-full" />
    {:else}
      <p class="mt-3 text-body-sm text-muted-foreground">{t("noStudentSubmissions")}</p>
    {/if}
  </div>
</section>

<section class="rounded-3xl border border-border bg-[color:var(--color-panel)] px-6 py-6 shadow-rest backdrop-blur-sm">
  <div class="flex items-center justify-between gap-3">
    <h3 class="text-title-sm font-semibold">{t("assessmentDrilldown")}</h3>
    <a href="/courses/{course.slug}/manage/progress" class="text-body-sm text-primary hover:underline">
      {t("goMatrix")}
    </a>
  </div>

  {#if analytics.assessmentRows.length === 0}
    <p class="mt-4 text-body-sm text-muted-foreground">{t("noPublishedToAnalyze")}</p>
  {:else}
    <div class="mt-4 overflow-x-auto rounded-xl border border-border-subtle">
      <table class="w-full min-w-220 text-body-sm">
        <thead>
          <tr class="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th class="px-3 py-2">{t("assessment")}</th>
            <th class="px-3 py-2">{t("window")}</th>
            <th class="px-3 py-2 text-center">{t("problems")}</th>
            <th class="px-3 py-2 text-center">{t("participants")}</th>
            <th class="px-3 py-2 text-center">{t("submissions")}</th>
            <th class="px-3 py-2 text-center">{t("acceptedSubs")}</th>
            <th class="px-3 py-2 text-center">{t("students")}</th>
            <th class="px-3 py-2 text-center">{t("avgBestScore")}</th>
            <th class="px-3 py-2">{t("latestSubmit")}</th>
            <th class="px-3 py-2">{t("actions")}</th>
          </tr>
        </thead>
        <tbody>
          {#each analytics.assessmentRows as row (row.id)}
            <tr class="border-b border-border last:border-b-0">
              <td class="px-3 py-2">
                <div class="flex items-center gap-2">
                  <a class="font-medium hover:underline" href="/courses/{course.slug}/manage/progress?assessment={row.slug}">
                    {row.title}
                  </a>
                  {#if row.isActive}
                    <Badge variant="success" size="xs" dot>
                      {t("active")}
                    </Badge>
                  {/if}
                </div>
                <p class="text-xs text-muted-foreground">/{row.slug}</p>
              </td>
              <td class="px-3 py-2 text-xs text-muted-foreground">
                <div>{new Date(row.opensAt).toLocaleString()}</div>
                <div>to {new Date(row.closesAt).toLocaleString()}</div>
              </td>
              <td class="px-3 py-2 text-center">{row.problemCount}</td>
              <td class="px-3 py-2 text-center">
                {row.participantCount} ({row.participantRate}%)
              </td>
              <td class="px-3 py-2 text-center">{row.submissionCount}</td>
              <td class="px-3 py-2 text-center">{row.acceptedSubmissions}</td>
              <td class="px-3 py-2 text-center">
                {row.acceptedStudents} ({row.acceptedStudentRate}%)
              </td>
              <td class="px-3 py-2 text-center">{row.avgBestScore}</td>
              <td class="px-3 py-2 text-xs text-muted-foreground">
                {row.latestSubmissionAt ? new Date(row.latestSubmissionAt).toLocaleString() : "-"}
              </td>
              <td class="px-3 py-2">
                <div class="flex flex-col gap-1 text-xs">
                  <a class="text-primary hover:underline" href="/courses/{course.slug}/manage/progress?assessment={row.slug}">
                    {t("matrixView")}
                  </a>
                  <a class="text-primary hover:underline" href="/courses/{course.slug}/manage/assessments">
                    {t("assessmentSettings")}
                  </a>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<section class="rounded-3xl border border-border bg-[color:var(--color-panel)] px-6 py-6 shadow-rest backdrop-blur-sm">
  <h3 class="text-title-sm font-semibold">{t("studentAttention")}</h3>
  <p class="mt-1 text-body-sm text-muted-foreground">
    {t("studentAttentionDesc")}
  </p>

  {#if analytics.atRiskStudents.length === 0}
    <p class="mt-4 text-body-sm text-muted-foreground">{t("noAtRisk")}</p>
  {:else}
    <div class="mt-4 grid gap-3 md:grid-cols-2">
      {#each analytics.atRiskStudents as student (student.userId)}
        <div class="rounded-xl border border-border-subtle px-4 py-3">
          <div class="flex items-center justify-between gap-3">
            <p class="font-medium">{student.username}</p>
            <Badge variant="warning">attention</Badge>
          </div>
          <p class="mt-1 text-caption text-muted-foreground tabular-nums">
            submissions: {student.submissionCount} / accepted: {student.acceptedCount}
          </p>
        </div>
      {/each}
    </div>
  {/if}
</section>
