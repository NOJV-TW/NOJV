<script lang="ts">
  import { ChevronRight, Info } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/utils.js";
  import { formatDateTimeCompact, fmtDate, fmtWeekday } from "$lib/utils/datetime";
  import AssignmentProblemsTab from "$lib/components/course/assignment/AssignmentProblemsTab.svelte";
  import AssignmentSubmissionsMatrix from "$lib/components/course/assignment/AssignmentSubmissionsMatrix.svelte";
  import AssignmentPlagiarismReport from "$lib/components/course/assignment/AssignmentPlagiarismReport.svelte";
  import AssignmentSettingsTab from "$lib/components/course/assignment/AssignmentSettingsTab.svelte";
  import { Button } from "$lib/components/ui/button";
  import ScoreOverrideDrawer from "$lib/components/score-override/ScoreOverrideDrawer.svelte";
  import ClarificationTab from "$lib/components/clarification/ClarificationTab.svelte";
  import Crumbs from "$lib/components/coursework/Crumbs.svelte";
  import GlassPanel from "$lib/components/coursework/GlassPanel.svelte";
  import DotGrid from "$lib/components/coursework/DotGrid.svelte";
  import TypeIcon from "$lib/components/coursework/TypeIcon.svelte";
  import StatusPill from "$lib/components/coursework/StatusPill.svelte";
  import Countdown from "$lib/components/coursework/Countdown.svelte";
  import DifficultyTick from "$lib/components/coursework/DifficultyTick.svelte";
  import { deriveAssignmentLiveStatus } from "$lib/utils/assignment-status";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const detail = $derived(data.detail);

  type SubTabKey = "problems" | "submissions" | "plagiarism" | "settings" | "clarifications";
  let activeSubTab = $state<SubTabKey>("submissions");

  const clarificationProblems = $derived(
    detail.problems.map((p) => ({ id: p.problemId, title: p.title }))
  );
  const clarificationEnabled = $derived(data.clarification.canView);

  let showOverrideDrawer = $state(false);
  const canSetOverride = $derived(
    data.mode === "teacher" ? (data.canSetOverride ?? false) : false
  );
  const overrideStudents = $derived(
    data.mode === "teacher"
      ? data.matrix.rows.map((r) => ({
          id: r.userId,
          username: r.handle,
          name: r.displayName
        }))
      : []
  );
  const overrideProblems = $derived(
    data.mode === "teacher"
      ? detail.problems.map((p) => ({ id: p.problemId, title: p.title }))
      : []
  );

  const subTabs: { key: SubTabKey; label: string; count?: number }[] = $derived([
    { key: "problems", label: m.assignmentDetail_tabProblems() },
    data.mode === "teacher"
      ? {
          key: "submissions",
          label: m.assignmentDetail_tabSubmissions(),
          count: data.matrix.studentCount
        }
      : { key: "submissions", label: m.assignmentDetail_tabSubmissions() },
    { key: "plagiarism", label: m.assignmentDetail_tabPlagiarism() },
    { key: "settings", label: m.assignmentDetail_tabSettings() },
    ...(clarificationEnabled
      ? [{ key: "clarifications" as const, label: m.clarification_tab_title() }]
      : [])
  ]);

  function difficultyLabel(d: "easy" | "medium" | "hard"): "Easy" | "Medium" | "Hard" {
    if (d === "easy") return "Easy";
    if (d === "medium") return "Medium";
    return "Hard";
  }

  function verdictLabel(status: string): string {
    if (status === "accepted") return "AC";
    if (status === "wrong_answer") return "WA";
    if (status === "time_limit_exceeded") return "TLE";
    if (status === "memory_limit_exceeded") return "MLE";
    if (status === "runtime_error") return "RE";
    if (status === "compile_error") return "CE";
    return status.toUpperCase();
  }

  function verdictClass(status: string): string {
    if (status === "accepted") return "verdict-ac";
    if (status === "wrong_answer" || status === "runtime_error" || status === "compile_error")
      return "verdict-wa";
    if (status === "time_limit_exceeded" || status === "memory_limit_exceeded")
      return "verdict-tle";
    return "verdict-pending";
  }

  // Derived assignment-level stats from problems[].
  const solved = $derived(
    detail.problems.filter((p) => p.myStatus?.state === "ac").length
  );
  const allSolved = $derived(detail.problemCount > 0 && solved === detail.problemCount);
  const myScore = $derived(
    detail.problems.reduce((sum, p) => sum + (p.myStatus?.bestScore ?? 0), 0)
  );
  const pct = $derived(
    detail.problemCount > 0 ? Math.round((solved / detail.problemCount) * 100) : 0
  );

  // Map domain status onto the design's student-facing vocabulary so the
  // shared StatusPill renders the right label/color.
  const status = $derived.by(() => {
    switch (detail.status) {
      case "upcoming":
        return "not_started";
      case "open":
        return "in_progress";
      case "closed":
        return allSolved ? "graded" : "submitted";
      case "draft":
      default:
        return "not_started";
    }
  });

  // After close, drop assignment context so the problem opens as practice
  // (no attempt counting, no scoreboard write).
  function problemHref(problemId: string): string {
    if (detail.status === "closed") {
      return `/problems/${problemId}`;
    }
    return `/assignments/${detail.id}/problems/${problemId}`;
  }

  // Display target for the headline countdown: prefer dueAt when present,
  // otherwise the close time.
  const targetIso = $derived(detail.dueAt ?? detail.closesAt);
</script>

<div class="space-y-6 fade-up px-6 py-8 lg:px-10 pb-20">
  <Crumbs
    items={[
      { label: "assignments", href: "/assignments" },
      { label: detail.title }
    ]}
  />

  <div class="grid gap-6 lg:grid-cols-[1fr_320px]">
    <!-- Hero -->
    <GlassPanel class="relative overflow-hidden p-7 lg:p-9">
      <DotGrid opacity={0.18} />
      <div class="relative">
        <div
          class="flex items-center gap-2 text-micro font-mono uppercase tracking-wider text-muted-foreground"
        >
          <TypeIcon kind="assignment" size={14} />
          <span>Assignment · {data.course.title}</span>
        </div>
        <div class="mt-3 flex items-baseline gap-3 flex-wrap">
          <StatusPill {status} type="assignment" />
          {#if data.mode === "teacher"}
            <span
              class="inline-flex items-center rounded-full px-2.5 py-1 text-micro font-mono uppercase tracking-wider"
              style="background: color-mix(in oklab, var(--info) 12%, transparent); color: var(--info);"
            >
              Manager View
            </span>
          {/if}
        </div>
        <h1
          class="mt-2 font-semibold tracking-tight"
          style="font-size: clamp(2rem, 4vw, 3rem); line-height: 1.05;"
        >
          {detail.title}
        </h1>
        {#if detail.summary}
          <p class="mt-5 max-w-2xl text-body text-muted-foreground">
            {detail.summary}
          </p>
        {/if}
        {#if data.mode === "teacher" && canSetOverride}
          <div class="mt-6">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onclick={() => (showOverrideDrawer = true)}
            >
              {m.override_staff_buttonLabel()}
            </Button>
          </div>
        {/if}
      </div>
    </GlassPanel>

    <!-- Sidebar facts -->
    <div class="space-y-4">
      <GlassPanel class="p-5">
        <div class="text-micro font-mono uppercase tracking-wider text-muted-foreground">
          {detail.dueAt ? m.assignmentDetail_metaDueAt() : m.assignmentDetail_metaClosesAt()}
        </div>
        <div class="mt-1 text-title font-semibold">
          {fmtDate(targetIso)} {m.coursework_weekdayPrefix({ day: fmtWeekday(targetIso) })}
        </div>
        <div class="mt-3"><Countdown iso={targetIso} /></div>
        {#if detail.dueAt && detail.dueAt !== detail.closesAt}
          <div class="mt-3 text-caption text-muted-foreground font-mono">
            {m.assignmentDetail_metaContinueUntil({ when: fmtDate(detail.closesAt) })}
          </div>
        {/if}
      </GlassPanel>

      <GlassPanel class="p-5">
        <div class="grid grid-cols-2 gap-y-3 text-body-sm">
          <div>
            <div
              class="text-micro font-mono uppercase tracking-wider text-muted-foreground"
            >
              {m.assignmentDetail_metaProgress()}
            </div>
            <div class="mt-0.5 font-mono">
              <span class="font-semibold text-body">{solved}</span> / {m.assignmentDetail_problemsCountWithUnit({ count: detail.problemCount })}
            </div>
          </div>
          <div>
            <div
              class="text-micro font-mono uppercase tracking-wider text-muted-foreground"
            >
              {m.assignmentDetail_metaScore()}
            </div>
            <div class="mt-0.5 font-mono">
              <span class="font-semibold text-body">{myScore}</span> / {detail.totalPoints}
            </div>
          </div>
          <div>
            <div
              class="text-micro font-mono uppercase tracking-wider text-muted-foreground"
            >
              {m.assignmentDetail_metaDailyAttempts()}
            </div>
            <div class="mt-0.5">
              {#if detail.maxAttemptsPerDay}
                {m.assignmentDetail_metaAttemptsCount({ count: detail.maxAttemptsPerDay })}
              {:else}
                {m.assignmentDetail_metaAttemptsUnlimited2()}
              {/if}
            </div>
          </div>
          <div>
            <div
              class="text-micro font-mono uppercase tracking-wider text-muted-foreground"
            >
              {m.assignmentDetail_metaAllowedLanguages()}
            </div>
            <div class="mt-0.5 text-caption text-muted-foreground">
              {#if detail.allowedLanguages.length > 0}
                {m.assignmentDetail_metaLanguageCount({ count: detail.allowedLanguages.length })}
              {:else}
                {m.assignmentDetail_metaLanguagePolicy()}
              {/if}
            </div>
          </div>
        </div>
      </GlassPanel>
    </div>
  </div>

  {#if data.mode === "student"}
    <!-- ══════ STUDENT VIEW ══════ -->

    <GlassPanel class="overflow-hidden">
      <div
        class="flex items-center justify-between px-6 py-4 border-b"
        style="border-color: var(--border-subtle);"
      >
        <h2 class="text-title font-semibold">{m.assignmentDetail_problemsHeading()}</h2>
        <div class="text-caption text-muted-foreground font-mono">
          {m.assignmentDetail_problemsProgressMeta({ solved, total: detail.problemCount, pct })}
        </div>
      </div>

      {#if detail.status === "upcoming"}
        <div class="px-6 py-12 text-center">
          <p class="text-body-lg font-medium text-foreground">
            {m.assignmentDetail_studentProblemsLockedTitle()}
          </p>
          <p class="mt-2 text-body-sm text-muted-foreground">
            {m.assignmentDetail_studentProblemsLockedHint({
              when: formatDateTimeCompact(detail.opensAt)
            })}
          </p>
        </div>
      {:else if detail.problems.length === 0}
        <div class="px-6 py-12 text-center text-body-sm text-muted-foreground">
          {m.assignmentDetail_problemsNotConfigured()}
        </div>
      {:else}
        <div class="divide-y" style="border-color: var(--border-subtle);">
          {#each detail.problems as problem (problem.problemId)}
            {@const isSolved = problem.myStatus?.state === "ac"}
            {@const tries = problem.myStatus?.attempts ?? 0}
            {@const score = problem.myStatus?.bestScore ?? 0}
            <div
              class="grid grid-cols-[60px_1fr_auto_auto_auto] items-center gap-4 px-6 py-3.5 hover:bg-muted/40 transition-colors"
              style="border-color: var(--border-subtle);"
            >
              <div class="font-mono text-body font-semibold text-muted-foreground">
                {problem.letter}
              </div>
              <div class="min-w-0">
                <div class="font-medium truncate">{problem.title}</div>
                <div class="mt-1 flex items-center gap-3">
                  <DifficultyTick level={difficultyLabel(problem.difficulty)} />
                  <span
                    class="text-micro font-mono uppercase tracking-wider text-muted-foreground"
                  >
                    {m.assignmentDetail_problemAttempts({ count: tries })}
                  </span>
                  {#if problem.myStatus?.overridden}
                    <span
                      class="inline-flex items-center text-info"
                      title={m.override_student_markerTooltip()}
                      aria-label={m.override_student_marker()}
                    >
                      <Info class="size-3.5" aria-hidden="true" />
                    </span>
                  {/if}
                </div>
              </div>
              <div class="hidden sm:block">
                {#if isSolved}
                  <span
                    class="inline-flex items-center gap-1.5 text-caption verdict-ac rounded-full px-2.5 py-1 font-mono uppercase tracking-wider"
                  >
                    AC
                  </span>
                {:else}
                  <span
                    class="text-caption font-mono uppercase tracking-wider text-muted-foreground"
                  >
                    —
                  </span>
                {/if}
              </div>
              <div class="font-mono text-body-sm tabular-nums w-20 text-right">
                <span class={isSolved ? "font-semibold" : "text-muted-foreground"}>
                  {score}
                </span>
                <span class="text-muted-foreground"> / {problem.points}</span>
              </div>
              {#if data.course.archived}
                <span
                  class="text-caption font-medium px-3 py-1.5 rounded-md border text-muted-foreground"
                  style="border-color: var(--border-subtle);"
                  aria-disabled="true"
                >
                  {m.assignmentDetail_problemArchived()}
                </span>
              {:else}
                <a
                  href={problemHref(problem.problemId)}
                  class="text-caption font-medium px-3 py-1.5 rounded-md border transition-colors hover:border-default no-underline text-foreground inline-flex items-center gap-1"
                  style="border-color: var(--border-subtle);"
                >
                  {isSolved ? m.assignmentDetail_problemView() : m.assignmentDetail_problemSolve()}
                  <ChevronRight class="size-3.5" />
                </a>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </GlassPanel>

    <GlassPanel class="overflow-hidden">
      <div
        class="flex items-center justify-between px-6 py-4 border-b"
        style="border-color: var(--border-subtle);"
      >
        <h2 class="text-title font-semibold">
          {m.assignmentDetail_studentSubmissionLogHeading()}
        </h2>
        <span class="text-caption text-muted-foreground">
          {m.assignmentDetail_studentSubmissionLogHint()}
        </span>
      </div>

      {#if !detail.myRecentSubmissions || detail.myRecentSubmissions.length === 0}
        <div class="px-6 py-12 text-center text-body-sm text-muted-foreground">
          {m.assignmentDetail_studentNoSubmissions()}
        </div>
      {:else}
        <div class="divide-y" style="border-color: var(--border-subtle);">
          {#each detail.myRecentSubmissions as entry (entry.id)}
            <a
              href={`/submissions/${entry.id}`}
              class="grid grid-cols-[120px_1fr_auto_auto_auto] items-center gap-4 px-6 py-3 text-inherit no-underline hover:bg-muted/40 transition-colors font-mono text-body-sm"
            >
              <span class="text-muted-foreground tabular-nums">
                {formatDateTimeCompact(entry.createdAt)}
              </span>
              <span class="truncate">
                <span class="text-foreground">{entry.problemLetter}</span> ·
                {entry.problemTitle}
              </span>
              <span
                class={cn(
                  "inline-flex items-center rounded-full px-2.5 py-1 text-micro uppercase tracking-wider font-mono",
                  verdictClass(entry.status)
                )}
              >
                {verdictLabel(entry.status)}
              </span>
              <span class="tabular-nums">{entry.score} / 100</span>
              <ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </a>
          {/each}
        </div>
      {/if}
    </GlassPanel>

    {#if clarificationEnabled}
      <GlassPanel class="p-6">
        <h2 class="text-title font-semibold leading-tight">
          {m.clarification_tab_title()}
        </h2>
        <div class="mt-4">
          <ClarificationTab
            contextType="assignment"
            contextId={detail.id}
            canAsk={data.clarification.canAsk}
            canAnswer={data.clarification.canAnswer}
            problems={clarificationProblems}
          />
        </div>
      </GlassPanel>
    {/if}
  {:else}
    <!-- ══════ TEACHER VIEW ══════ -->
    <GlassPanel class="overflow-hidden">
      <nav
        aria-label="Assignment sections"
        class="border-b px-2"
        style="border-color: var(--border-subtle);"
      >
        <div class="flex items-center gap-1">
          {#each subTabs as tab (tab.key)}
            {@const isActive = activeSubTab === tab.key}
            <button
              type="button"
              aria-current={isActive ? "page" : undefined}
              onclick={() => (activeSubTab = tab.key)}
              class={cn(
                "-mb-px inline-flex items-center gap-2 border-b-2 px-5 py-3 text-body-sm font-medium transition-colors duration-fast ease-out-soft",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <span>{tab.label}</span>
              {#if tab.count !== undefined}
                <span
                  class={cn(
                    "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-micro font-semibold tabular-nums",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {tab.count}
                </span>
              {/if}
            </button>
          {/each}
        </div>
      </nav>

      <div class="p-6">
        {#if activeSubTab === "problems"}
          <AssignmentProblemsTab
            problems={detail.problems}
            assessmentId={detail.id}
            canEdit={data.mode === "teacher" && detail.status !== "closed"}
            candidateProblems={data.mode === "teacher" ? data.candidateProblems : []}
          />
        {:else if activeSubTab === "submissions"}
          <AssignmentSubmissionsMatrix
            matrix={data.matrix}
            courseId={detail.courseId}
            assessmentId={detail.id}
          />
        {:else if activeSubTab === "plagiarism"}
          <AssignmentPlagiarismReport
            report={data.plagiarism}
            flags={data.plagiarismFlags ?? []}
            assessmentId={detail.id}
            problems={detail.problems.map((p) => ({
              problemId: p.problemId,
              letter: p.letter,
              title: p.title
            }))}
            students={data.matrix.rows.map((r) => ({
              userId: r.userId,
              displayName: r.displayName,
              handle: r.handle
            }))}
          />
        {:else if activeSubTab === "settings" && data.mode === "teacher"}
          <AssignmentSettingsTab
            form={data.settingsForm}
            {detail}
            liveStatus={deriveAssignmentLiveStatus(
              data.assessment.status,
              detail.opensAt,
              detail.closesAt
            )}
          />
        {:else if activeSubTab === "clarifications"}
          <ClarificationTab
            contextType="assignment"
            contextId={detail.id}
            canAsk={data.clarification.canAsk}
            canAnswer={data.clarification.canAnswer}
            problems={clarificationProblems}
          />
        {/if}
      </div>
    </GlassPanel>
  {/if}
</div>

{#if canSetOverride}
  <ScoreOverrideDrawer
    open={showOverrideDrawer}
    onOpenChange={(v) => (showOverrideDrawer = v)}
    contextType="assignment"
    contextId={detail.id}
    students={overrideStudents}
    problems={overrideProblems}
  />
{/if}
