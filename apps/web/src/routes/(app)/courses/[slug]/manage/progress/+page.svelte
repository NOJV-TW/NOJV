<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import EChart from "$lib/components/charts/EChart.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import * as Select from "$lib/components/ui/select";
  import type { EChartsOption } from "echarts";

  let { data } = $props();

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
        name: "AC rate",
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
        name: "Solve distribution",
        type: "pie",
        radius: ["40%", "68%"],
        label: { formatter: "{b}: {d}%" },
        data: [
          { name: "Solved", value: verdictRows.solved, itemStyle: { color: "#10b981" } },
          { name: "Unsolved", value: verdictRows.unsolved, itemStyle: { color: "#ef4444" } }
        ]
      }
    ]
  }));

  const verdictDistributionOption: EChartsOption = $derived.by(() => ({
    tooltip: { trigger: "item" },
    legend: { bottom: 0 },
    series: [
      {
        name: "Best verdict",
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
  <div class="flex flex-wrap items-center justify-between gap-4">
    <div>
      <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">Student Progress</p>
      <p class="mt-1 text-sm text-muted-foreground">
        {matrix.students.length} students, {matrix.problems.length} problems
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
              {assessments.find((a) => a.slug === selectedAssessment)?.title ?? "All"}
            {:else}
              All assessments
            {/if}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="__all__" label="All assessments">All assessments</Select.Item>
            {#each assessments as assessment (assessment.slug)}
              <Select.Item value={assessment.slug} label={assessment.title}>
                <span class="inline-flex items-center gap-2">
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                  >
                    assignment
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
            {m.progress_exportCsv()}
          </a>
        {/if}
      </div>
    {/if}
  </div>

  {#if matrix.problems.length === 0}
    <div class="mt-8 text-center text-muted-foreground">
      {#if selectedAssessment}
        No problems found for this assessment.
      {:else}
        No problems linked to this course yet.
      {/if}
    </div>
  {:else if matrix.students.length === 0}
    <div class="mt-8 text-center text-muted-foreground">No students enrolled in this course.</div>
  {:else}
    <!-- KPI cards -->
    <div class="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-3">
        <p class="text-xs uppercase tracking-wider text-muted-foreground">Coverage</p>
        <p class="mt-1 text-2xl font-semibold">{attemptedRate}%</p>
        <p class="text-xs text-muted-foreground">{attemptedCells}/{totalCells} cells attempted</p>
      </div>
      <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-3">
        <p class="text-xs uppercase tracking-wider text-muted-foreground">Solved ratio</p>
        <p class="mt-1 text-2xl font-semibold">{solvedRate}%</p>
        <p class="text-xs text-muted-foreground">{solvedCells}/{totalCells} accepted cells</p>
      </div>
      <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-3">
        <p class="text-xs uppercase tracking-wider text-muted-foreground">Avg best score</p>
        <p class="mt-1 text-2xl font-semibold">{avgBestScore}</p>
        <p class="text-xs text-muted-foreground">Across attempted cells</p>
      </div>
      <div class="rounded-xl border border-border bg-(--color-panel) px-4 py-3">
        <p class="text-xs uppercase tracking-wider text-muted-foreground">Submission intensity</p>
        <p class="mt-1 text-2xl font-semibold">{avgSubmissionsPerCell}</p>
        <p class="text-xs text-muted-foreground">Avg submissions per attempted cell</p>
      </div>
    </div>

    <!-- Chart dashboard -->
    <div class="mt-6 grid gap-4 xl:grid-cols-2">
      <section class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
        <h3 class="text-sm font-semibold text-muted-foreground">Problem AC vs Attempt Rate</h3>
        <EChart option={problemStatusOption} class="mt-3 h-64 w-full" />
      </section>

      <section class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
        <h3 class="text-sm font-semibold text-muted-foreground">Average Best Score By Problem</h3>
        <EChart option={problemScoreOption} class="mt-3 h-64 w-full" />
      </section>

      <section class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
        <h3 class="text-sm font-semibold text-muted-foreground">Solve Distribution</h3>
        <EChart option={solveDistributionOption} class="mt-3 h-64 w-full" />
      </section>

      <section class="rounded-xl border border-border bg-(--color-panel) px-4 py-4">
        <h3 class="text-sm font-semibold text-muted-foreground">Best Verdict Distribution</h3>
        <EChart option={verdictDistributionOption} class="mt-3 h-64 w-full" />
      </section>
    </div>

    <section class="mt-4 rounded-xl border border-border bg-(--color-panel) px-4 py-4">
      <h3 class="text-sm font-semibold text-muted-foreground">Top Students (By Total Best Score)</h3>
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
              Student
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
