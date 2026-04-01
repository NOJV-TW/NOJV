<script lang="ts">
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { BarChart3, Download, Languages, PieChart, Table2, Users } from "@lucide/svelte";
  import EChart from "$lib/components/charts/EChart.svelte";
  import * as Select from "$lib/components/ui/select";
  import type { EChartsOption } from "echarts";
  import { onMount } from "svelte";

  let { data } = $props();

  type UiLang = "zh" | "en";
  let uiLang = $state<UiLang>("zh");

  const text = {
    en: {
      acRate: "AC rate",
      acceptedCells: "accepted cells",
      all: "All",
      allAssessments: "All assessments",
      assignment: "assignment",
      attemptedCells: "cells attempted",
      avgBestScore: "Avg best score",
      avgBestScoreByProblem: "Average Best Score By Problem",
      avgSubmissionsPerAttempted: "Avg submissions per attempted cell",
      acrossAttempted: "Across attempted cells",
      bestVerdict: "Best Verdict Distribution",
      coverage: "Coverage",
      english: "English",
      exportCsv: "Export CSV",
      noProblemsForAssessment: "No problems found for this assessment.",
      noProblemsForCourse: "No problems linked to this course yet.",
      noStudents: "No students enrolled in this course.",
      problemAcAttempt: "Problem AC vs Attempt Rate",
      progress: "Student Progress",
      solved: "Solved",
      solvedRatio: "Solved ratio",
      solveDistribution: "Solve Distribution",
      submissionIntensity: "Submission intensity",
      systemText: "System Text",
      topStudents: "Top Students (By Total Best Score)",
      unsolved: "Unsolved",
      students: "students",
      problems: "problems",
      student: "Student",
      zh: "中文"
    },
    zh: {
      acRate: "AC 比率",
      acceptedCells: "格 AC",
      all: "全部",
      allAssessments: "所有測驗",
      assignment: "測驗",
      attemptedCells: "格有嘗試",
      avgBestScore: "平均最佳分數",
      avgBestScoreByProblem: "各題平均最佳分數",
      avgSubmissionsPerAttempted: "每個有嘗試格平均提交數",
      acrossAttempted: "在有嘗試的格子中",
      bestVerdict: "最佳判定分布",
      coverage: "覆蓋率",
      english: "English",
      exportCsv: "匯出 CSV",
      noProblemsForAssessment: "此測驗目前沒有題目。",
      noProblemsForCourse: "此課程尚未連結題目。",
      noStudents: "此課程目前沒有學生。",
      problemAcAttempt: "各題 AC 與嘗試率",
      progress: "學生進度",
      solved: "已解",
      solvedRatio: "解題比例",
      solveDistribution: "解題分布",
      submissionIntensity: "提交強度",
      systemText: "系統文字",
      topStudents: "前段學生（依總最佳分數）",
      unsolved: "未解",
      students: "名學生",
      problems: "題",
      student: "學生",
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

  let matrix = $derived(data.matrix);
  let assessments = $derived(data.assessments);
  let selectedAssessment = $derived(data.selectedAssessment);

  let scoreEntries = $derived(Object.values(matrix.scores));
  let totalCells = $derived(matrix.students.length * matrix.problems.length);
  let attemptedCells = $derived(scoreEntries.length);
  let solvedCells = $derived(scoreEntries.filter((score) => score.bestVerdict === "accepted").length);
  let totalBestScore = $derived(scoreEntries.reduce((sum, score) => sum + score.bestScore, 0));
  let totalSubmissionCount = $derived(
    scoreEntries.reduce((sum, score) => sum + score.submissionCount, 0)
  );

  let attemptedRate = $derived(totalCells > 0 ? Math.round((attemptedCells / totalCells) * 100) : 0);
  let solvedRate = $derived(totalCells > 0 ? Math.round((solvedCells / totalCells) * 100) : 0);
  let avgBestScore = $derived(attemptedCells > 0 ? (totalBestScore / attemptedCells).toFixed(1) : "0.0");
  let avgSubmissionsPerCell = $derived(
    attemptedCells > 0 ? (totalSubmissionCount / attemptedCells).toFixed(1) : "0.0"
  );

  let problemPerformanceRows = $derived.by(() => {
    return matrix.problems.map((problem) => {
      const stats = matrix.problemStats[problem.problemId];
      const students = matrix.students.length;

      let attempts = 0;
      let scoreSum = 0;
      for (const student of matrix.students) {
        const score = matrix.scores[`${student.userId}:${problem.problemId}`];
        if (score) {
          attempts++;
          scoreSum += score.bestScore;
        }
      }

      const acRate = stats && stats.totalStudents > 0 ? (stats.acCount / stats.totalStudents) * 100 : 0;
      const attemptRate = students > 0 ? (attempts / students) * 100 : 0;
      const avgProblemScore = students > 0 ? scoreSum / students : 0;

      return {
        acRate: Math.round(acRate),
        attemptRate: Math.round(attemptRate),
        avgProblemScore: Number(avgProblemScore.toFixed(1)),
        slug: problem.slug,
        title: problem.title
      };
    });
  });

  let verdictRows = $derived.by(() => {
    const verdictMap = new Map<string, number>();
    for (const score of scoreEntries) {
      const label = verdictLabel(score.bestVerdict || "unknown");
      verdictMap.set(label, (verdictMap.get(label) ?? 0) + 1);
    }

    const solved = verdictMap.get("AC") ?? 0;
    const unsolved = Math.max(attemptedCells - solved, 0);

    return {
      solved,
      unsolved,
      byVerdict: [...verdictMap.entries()].map(([name, value]) => ({ name, value }))
    };
  });

  let leaderboardRows = $derived.by(() => {
    return matrix.students
      .map((student) => {
        let totalScore = 0;
        let acCount = 0;
        let attemptCount = 0;

        for (const problem of matrix.problems) {
          const score = matrix.scores[`${student.userId}:${problem.problemId}`];
          if (!score) continue;
          attemptCount++;
          totalScore += score.bestScore;
          if (score.bestVerdict === "accepted") acCount++;
        }

        return {
          acCount,
          attemptCount,
          studentName: student.username,
          totalScore
        };
      })
      .sort((left, right) => {
        if (right.totalScore !== left.totalScore) return right.totalScore - left.totalScore;
        if (right.acCount !== left.acCount) return right.acCount - left.acCount;
        return left.studentName.localeCompare(right.studentName);
      })
      .slice(0, 10);
  });

  const problemStatusOption: EChartsOption = $derived.by(() => ({
    grid: { left: 36, right: 20, top: 24, bottom: 56 },
    legend: { bottom: 0 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: problemPerformanceRows.map((row) => row.slug),
      axisLabel: {
        fontSize: 11,
        interval: 0,
        rotate: problemPerformanceRows.length > 6 ? 20 : 0
      }
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: { formatter: "{value}%", fontSize: 11 }
    },
    series: [
      {
        type: "bar",
        name: t("acRate"),
        data: problemPerformanceRows.map((row) => row.acRate),
        itemStyle: { color: "#10b981" },
        barMaxWidth: 28
      },
      {
        type: "bar",
        name: "Attempt rate",
        data: problemPerformanceRows.map((row) => row.attemptRate),
        itemStyle: { color: "#3b82f6" },
        barMaxWidth: 28
      }
    ]
  }));

  const problemScoreOption: EChartsOption = $derived.by(() => ({
    grid: { left: 42, right: 20, top: 24, bottom: 56 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: problemPerformanceRows.map((row) => row.slug),
      axisLabel: {
        fontSize: 11,
        interval: 0,
        rotate: problemPerformanceRows.length > 6 ? 20 : 0
      }
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: { fontSize: 11 }
    },
    series: [
      {
        type: "line",
        smooth: true,
        name: "Avg score",
        data: problemPerformanceRows.map((row) => row.avgProblemScore),
        itemStyle: { color: "#f59e0b" },
        areaStyle: { opacity: 0.12 }
      }
    ]
  }));

  const solveDistributionOption: EChartsOption = $derived.by(() => ({
    tooltip: { trigger: "item" },
    legend: { bottom: 0 },
    series: [
      {
        name: t("solveDistribution"),
        type: "pie",
        radius: ["40%", "68%"],
        label: { formatter: "{b}: {d}%" },
        data: [
          { name: t("solved"), value: verdictRows.solved, itemStyle: { color: "#10b981" } },
          { name: t("unsolved"), value: verdictRows.unsolved, itemStyle: { color: "#ef4444" } }
        ]
      }
    ]
  }));

  const verdictDistributionOption: EChartsOption = $derived.by(() => ({
    tooltip: { trigger: "item" },
    legend: { bottom: 0 },
    series: [
      {
        name: t("bestVerdict"),
        type: "pie",
        radius: ["40%", "68%"],
        label: { formatter: "{b}: {c}" },
        data: verdictRows.byVerdict
      }
    ]
  }));

  const leaderboardOption: EChartsOption = $derived.by(() => ({
    grid: { left: 90, right: 20, top: 24, bottom: 28 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "value",
      min: 0,
      axisLabel: { fontSize: 11 }
    },
    yAxis: {
      type: "category",
      data: leaderboardRows.map((row) => row.studentName),
      axisLabel: { fontSize: 11 }
    },
    series: [
      {
        type: "bar",
        name: "Total score",
        data: leaderboardRows.map((row) => row.totalScore),
        itemStyle: { color: "#6366f1" },
        barMaxWidth: 26,
        label: {
          show: true,
          position: "right",
          formatter: ({ dataIndex }: { dataIndex: number }) => `AC ${leaderboardRows[dataIndex]?.acCount ?? 0}`
        }
      }
    ]
  }));

  function onAssessmentChange(value: string | undefined) {
    const url = new URL($page.url);
    if (value && value !== "__all__") {
      url.searchParams.set("assessment", value);
    } else {
      url.searchParams.delete("assessment");
    }
    goto(url.toString(), { replaceState: true });
  }

  function cellClass(score: { bestScore: number; bestVerdict: string } | undefined): string {
    if (!score) return "";
    if (score.bestVerdict === "accepted") return "bg-green-100 dark:bg-green-950/40";
    if (score.bestScore > 0) return "bg-yellow-100 dark:bg-yellow-950/40";
    return "bg-red-100 dark:bg-red-950/40";
  }

  function verdictIcon(score: { bestVerdict: string } | undefined): string {
    if (!score) return "\u2014";
    if (score.bestVerdict === "accepted") return "\u2713";
    return "\u2717";
  }

  function verdictLabel(verdict: string): string {
    switch (verdict) {
      case "accepted":
        return "AC";
      case "wrong_answer":
        return "WA";
      case "time_limit_exceeded":
        return "TLE";
      case "memory_limit_exceeded":
        return "MLE";
      case "runtime_error":
        return "RE";
      case "compile_error":
        return "CE";
      default:
        return verdict.toUpperCase();
    }
  }

  function acPercent(problemId: string): string {
    const stats = matrix.problemStats[problemId];
    if (!stats || stats.totalStudents === 0) return "0%";
    return `${Math.round((stats.acCount / stats.totalStudents) * 100)}%`;
  }
</script>

<section
  class="rounded-4xl border border-border bg-(--color-panel-strong) px-6 py-8 backdrop-blur-sm"
>
  <div class="mb-3 flex justify-end">
    <div class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 p-1">
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

  <div class="flex flex-wrap items-center justify-between gap-4">
    <div>
      <p class="inline-flex items-center gap-1 text-sm uppercase tracking-[0.18em] text-muted-foreground"><Users class="h-4 w-4" /> {t("progress")}</p>
      <p class="mt-1 text-sm text-muted-foreground">
        {matrix.students.length} {t("students")}, {matrix.problems.length} {t("problems")}
      </p>
    </div>

    {#if assessments.length > 0}
      <div class="flex items-center gap-2">
        <Select.Root
          type="single"
          value={selectedAssessment ?? "__all__"}
          onValueChange={onAssessmentChange}
        >
          <Select.Trigger class="w-55">
            {#if selectedAssessment}
              {assessments.find((a) => a.slug === selectedAssessment)?.title ?? t("all")}
            {:else}
              {t("allAssessments")}
            {/if}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="__all__" label={t("allAssessments")}>{t("allAssessments")}</Select.Item>
            {#each assessments as assessment (assessment.slug)}
              <Select.Item value={assessment.slug} label={assessment.title}>
                <span class="inline-flex items-center gap-2">
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                  >
                    {t("assignment")}
                  </span>
                  {assessment.title}
                </span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>

        {#if selectedAssessment}
          <a
            href="/courses/{data.courseSlug}/manage/progress/export?assessment={selectedAssessment}"
            download="progress-{selectedAssessment}.csv"
            class="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-(--color-panel) px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Download class="h-4 w-4" /> {t("exportCsv")}
          </a>
        {/if}
      </div>
    {/if}
  </div>

  {#if matrix.problems.length === 0}
    <div class="mt-8 text-center text-muted-foreground">
      {#if selectedAssessment}
        {t("noProblemsForAssessment")}
      {:else}
        {t("noProblemsForCourse")}
      {/if}
    </div>
  {:else if matrix.students.length === 0}
    <div class="mt-8 text-center text-muted-foreground">{t("noStudents")}</div>
  {:else}
    <!-- KPI cards -->
    <div class="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-3">
        <p class="text-xs uppercase tracking-wider text-muted-foreground">{t("coverage")}</p>
        <p class="mt-1 text-2xl font-semibold">{attemptedRate}%</p>
        <p class="text-xs text-muted-foreground">{attemptedCells}/{totalCells} {t("attemptedCells")}</p>
      </div>
      <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-3">
        <p class="text-xs uppercase tracking-wider text-muted-foreground">{t("solvedRatio")}</p>
        <p class="mt-1 text-2xl font-semibold">{solvedRate}%</p>
        <p class="text-xs text-muted-foreground">{solvedCells}/{totalCells} {t("acceptedCells")}</p>
      </div>
      <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-3">
        <p class="text-xs uppercase tracking-wider text-muted-foreground">{t("avgBestScore")}</p>
        <p class="mt-1 text-2xl font-semibold">{avgBestScore}</p>
        <p class="text-xs text-muted-foreground">{t("acrossAttempted")}</p>
      </div>
      <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-3">
        <p class="text-xs uppercase tracking-wider text-muted-foreground">{t("submissionIntensity")}</p>
        <p class="mt-1 text-2xl font-semibold">{avgSubmissionsPerCell}</p>
        <p class="text-xs text-muted-foreground">{t("avgSubmissionsPerAttempted")}</p>
      </div>
    </div>

    <!-- Chart dashboard -->
    <div class="mt-6 grid gap-4 xl:grid-cols-2">
      <section class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
        <h3 class="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground"><BarChart3 class="h-4 w-4" /> {t("problemAcAttempt")}</h3>
        <EChart option={problemStatusOption} class="mt-3 h-64 w-full" />
      </section>

      <section class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
        <h3 class="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground"><BarChart3 class="h-4 w-4" /> {t("avgBestScoreByProblem")}</h3>
        <EChart option={problemScoreOption} class="mt-3 h-64 w-full" />
      </section>

      <section class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
        <h3 class="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground"><PieChart class="h-4 w-4" /> {t("solveDistribution")}</h3>
        <EChart option={solveDistributionOption} class="mt-3 h-64 w-full" />
      </section>

      <section class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
        <h3 class="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground"><PieChart class="h-4 w-4" /> {t("bestVerdict")}</h3>
        <EChart option={verdictDistributionOption} class="mt-3 h-64 w-full" />
      </section>
    </div>

    <section class="mt-4 rounded-xl border border-border bg-(--color-panel) px-4 py-4">
      <h3 class="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground"><Users class="h-4 w-4" /> {t("topStudents")}</h3>
      <EChart option={leaderboardOption} class="mt-3 h-72 w-full" />
    </section>

    <!-- Stats bar -->
    <div class="mt-6 flex flex-wrap gap-3">
      {#each matrix.problems as problem (problem.problemId)}
        {@const pct = acPercent(problem.problemId)}
        <div
          class="rounded-xl border border-border bg-(--color-panel) px-3 py-2 text-sm"
        >
          <span class="font-medium">{problem.title}</span>
          <span class="ml-2 text-muted-foreground">({pct} AC)</span>
        </div>
      {/each}
    </div>

    <!-- Matrix table -->
    <div class="mt-6 overflow-x-auto rounded-xl border border-border">
      <table class="w-full min-w-150 border-collapse text-sm">
        <thead>
          <tr class="border-b border-border bg-(--color-panel)">
            <th
              class="sticky left-0 z-10 bg-(--color-panel) px-4 py-3 text-left font-medium text-muted-foreground"
            >
              <span class="inline-flex items-center gap-1"><Table2 class="h-4 w-4" /> {t("student")}</span>
            </th>
            {#each matrix.problems as problem (problem.problemId)}
              <th class="px-4 py-3 text-center font-medium text-muted-foreground">
                <div class="max-w-30 truncate" title={problem.title}>{problem.title}</div>
                <div class="text-xs font-normal">{acPercent(problem.problemId)} AC</div>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each matrix.students as student (student.userId)}
            <tr class="border-b border-border last:border-b-0 hover:bg-muted/50">
              <td
                class="sticky left-0 z-10 bg-(--color-panel-strong) px-4 py-2.5 font-medium"
              >
                <div class="max-w-40 truncate" title={student.name}>
                  {student.username}
                </div>
              </td>
              {#each matrix.problems as problem (problem.problemId)}
                {@const score = matrix.scores[`${student.userId}:${problem.problemId}`]}
                <td class="px-4 py-2.5 text-center {cellClass(score)}">
                  {#if score}
                    <div class="flex flex-col items-center gap-0.5">
                      <span
                        class="text-base {score.bestVerdict === 'accepted'
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-600 dark:text-red-400'}"
                      >
                        {verdictIcon(score)}
                      </span>
                      <span class="text-xs text-muted-foreground">
                        {verdictLabel(score.bestVerdict)}
                        ({score.bestScore})
                      </span>
                    </div>
                  {:else}
                    <span class="text-muted-foreground">&mdash;</span>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
