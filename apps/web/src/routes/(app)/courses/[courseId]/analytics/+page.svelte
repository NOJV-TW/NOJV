<script lang="ts">
  import { AlertTriangle, BarChart3, ClipboardList, PieChart, TrendingDown } from "@lucide/svelte";
  import type { EChartsOption } from "echarts";
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import EChart from "$lib/components/primitives/charts/EChart.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import { formatVerdictLabel } from "$lib/utils/verdict-style";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const analytics = $derived(data.analytics);

  function formatPercent(fraction: number): string {
    return `${Math.round(fraction * 100)}%`;
  }

  // Pie slice colours follow the project verdict semantic map.
  const verdictColors: Record<string, string> = {
    accepted: "#10b981",
    wrong_answer: "#ef4444",
    time_limit_exceeded: "#f59e0b",
    memory_limit_exceeded: "#f97316",
    runtime_error: "#a855f7",
    compile_error: "#f59e0b",
    queued: "#3b82f6",
    running: "#3b82f6"
  };

  const verdictOption: EChartsOption = $derived({
    tooltip: { trigger: "item" },
    legend: { bottom: 0, type: "scroll" },
    series: [
      {
        type: "pie",
        radius: ["42%", "68%"],
        data: analytics.verdictDistribution.map((entry) => ({
          name: formatVerdictLabel(entry.status),
          value: entry.count,
          itemStyle: { color: verdictColors[entry.status] ?? "#6b7280" }
        }))
      }
    ]
  });

  // Lowest AC rate = hardest. Surface the bottom band in a warning tone.
  function acRateTone(acRate: number): "destructive" | "warning" | "muted" {
    if (acRate < 0.3) return "destructive";
    if (acRate < 0.6) return "warning";
    return "muted";
  }
</script>

<div class="space-y-10 pb-20">
  <!-- Per-assessment summary -->
  <section class="animate-in animate-in-1 space-y-4">
    <h2 class="text-title-sm font-semibold">{m.courseAnalytics_assessmentsTitle()}</h2>
    {#if analytics.assessmentSummaries.length === 0}
      <EmptyState
        variant="minimal"
        icon={ClipboardList}
        title={m.courseAnalytics_assessmentsEmptyTitle()}
        description={m.courseAnalytics_assessmentsEmptyDescription()}
      />
    {:else}
      <div class="grid gap-3">
        {#each analytics.assessmentSummaries as summary (summary.assessmentId)}
          <Card variant="surface" size="lg">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div class="min-w-0">
                <h3 class="text-body-lg font-semibold tracking-[-0.01em]">
                  {summary.title}
                </h3>
                <p class="mt-1 text-caption text-muted-foreground">
                  {m.courseAnalytics_problemCount({ count: summary.problemCount })}
                </p>
              </div>
              <div class="flex items-center gap-8 font-mono tabular-nums">
                <div class="text-right">
                  <div class="text-title-sm font-semibold">{summary.studentCount}</div>
                  <div class="text-micro uppercase tracking-wide text-muted-foreground">
                    {m.courseAnalytics_metricStudents()}
                  </div>
                </div>
                <div class="text-right">
                  <div class="text-title-sm font-semibold">{summary.avgScore}</div>
                  <div class="text-micro uppercase tracking-wide text-muted-foreground">
                    {m.courseAnalytics_metricAvgScore()}
                  </div>
                </div>
                <div class="text-right">
                  <div class="text-title-sm font-semibold">
                    {formatPercent(summary.completionRate)}
                  </div>
                  <div class="text-micro uppercase tracking-wide text-muted-foreground">
                    {m.courseAnalytics_metricCompletion()}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        {/each}
      </div>
    {/if}
  </section>

  <div class="grid gap-8 lg:grid-cols-2">
    <!-- Hardest problems -->
    <section class="animate-in animate-in-2 space-y-4">
      <h2 class="text-title-sm font-semibold">{m.courseAnalytics_hardestTitle()}</h2>
      <p class="text-caption text-muted-foreground">
        {m.courseAnalytics_hardestSubtitle()}
      </p>
      {#if analytics.hardestProblems.length === 0}
        <EmptyState
          variant="minimal"
          icon={TrendingDown}
          title={m.courseAnalytics_hardestEmptyTitle()}
          description={m.courseAnalytics_hardestEmptyDescription()}
        />
      {:else}
        <div class="overflow-hidden rounded-xl border border-border bg-[color:var(--color-panel)]">
          {#each analytics.hardestProblems as problem (problem.problemId)}
            <a
              href={`/problems/${problem.displayId}`}
              class="flex items-center justify-between gap-4 border-b border-border-subtle px-5 py-4 transition-colors duration-fast ease-out-soft last:border-b-0 hover:bg-primary/[0.03]"
            >
              <div class="min-w-0">
                <div class="truncate text-body font-medium">{problem.title}</div>
                <div class="mt-0.5 font-mono text-caption text-muted-foreground tabular-nums">
                  {m.courseAnalytics_hardestSolvers({
                    solvers: problem.solvers,
                    attempters: problem.attempters
                  })}
                </div>
              </div>
              <Badge variant={acRateTone(problem.acRate)} size="sm">
                {m.courseAnalytics_hardestAcRate({ rate: formatPercent(problem.acRate) })}
              </Badge>
            </a>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Verdict distribution -->
    <section class="animate-in animate-in-2 space-y-4">
      <h2 class="text-title-sm font-semibold">{m.courseAnalytics_verdictsTitle()}</h2>
      <p class="text-caption text-muted-foreground">
        {m.courseAnalytics_verdictsSubtitle()}
      </p>
      <Card variant="surface" size="lg">
        {#if analytics.verdictDistribution.length === 0}
          <EmptyState
            variant="minimal"
            icon={PieChart}
            title={m.courseAnalytics_verdictsEmptyTitle()}
            description={m.courseAnalytics_verdictsEmptyDescription()}
          />
        {:else}
          <EChart option={verdictOption} class="h-64 w-full" />
        {/if}
      </Card>
    </section>
  </div>

  <!-- Students needing attention -->
  <section class="animate-in animate-in-3 space-y-4">
    <h2 class="text-title-sm font-semibold">{m.courseAnalytics_atRiskTitle()}</h2>
    <p class="text-caption text-muted-foreground">
      {m.courseAnalytics_atRiskSubtitle()}
    </p>
    {#if analytics.studentsAtRisk.length === 0}
      <EmptyState
        variant="minimal"
        icon={BarChart3}
        title={m.courseAnalytics_atRiskEmptyTitle()}
        description={analytics.studentCount === 0
          ? m.courseAnalytics_atRiskNoStudents()
          : m.courseAnalytics_atRiskAllEngaged()}
      />
    {:else}
      <div class="overflow-hidden rounded-xl border border-border bg-[color:var(--color-panel)]">
        {#each analytics.studentsAtRisk as student (student.userId)}
          <div
            class="flex items-center justify-between gap-4 border-b border-border-subtle px-5 py-4 last:border-b-0"
          >
            <div class="flex items-center gap-3">
              <span
                class="flex size-9 items-center justify-center rounded-full bg-warning/15 text-warning"
                aria-hidden="true"
              >
                <AlertTriangle class="size-4" />
              </span>
              <div class="min-w-0">
                <div class="truncate text-body font-medium">{student.name}</div>
                <div class="truncate font-mono text-caption text-muted-foreground">
                  {student.username ?? "—"}
                </div>
              </div>
            </div>
            <Badge variant={student.reason === "no_submissions" ? "destructive" : "warning"} size="sm">
              {student.reason === "no_submissions"
                ? m.courseAnalytics_atRiskNoSubmissions()
                : m.courseAnalytics_atRiskAllZero()}
            </Badge>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>
