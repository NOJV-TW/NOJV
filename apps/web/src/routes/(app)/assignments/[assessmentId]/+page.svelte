<script lang="ts">
  import { ChevronRight, Info } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Badge } from "$lib/components/ui/badge";
  import { cn } from "$lib/utils.js";
  import { formatTimeRangeCompact, formatDateTimeCompact } from "$lib/utils/datetime";
  import AssignmentProblemsTab from "$lib/components/course/assignment/AssignmentProblemsTab.svelte";
  import AssignmentSubmissionsMatrix from "$lib/components/course/assignment/AssignmentSubmissionsMatrix.svelte";
  import AssignmentPlagiarismReport from "$lib/components/course/assignment/AssignmentPlagiarismReport.svelte";
  import AssignmentSettingsTab from "$lib/components/course/assignment/AssignmentSettingsTab.svelte";
  import { Button } from "$lib/components/ui/button";
  import PageHero from "$lib/components/layout/PageHero.svelte";
  import ScoreOverrideDrawer from "$lib/components/score-override/ScoreOverrideDrawer.svelte";
  import ClarificationTab from "$lib/components/clarification/ClarificationTab.svelte";
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
  // Pull students + problems off the submissions matrix so we don't fetch twice.
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

  function statusBadge(
    status: "draft" | "upcoming" | "open" | "closed"
  ): { variant: "default" | "info" | "muted"; label: string; dot: boolean } {
    switch (status) {
      case "open":
        return { variant: "default", label: m.assignmentDetail_statusOpen(), dot: true };
      case "upcoming":
        return { variant: "info", label: m.assignmentDetail_statusUpcoming(), dot: true };
      case "draft":
        return { variant: "muted", label: m.assignmentDetail_statusDraft(), dot: false };
      case "closed":
      default:
        return { variant: "muted", label: m.assignmentDetail_statusClosed(), dot: false };
    }
  }

  function urgencyHint(
    status: "draft" | "upcoming" | "open" | "closed",
    opensAt: string,
    closesAt: string
  ): string | null {
    const now = Date.now();
    if (status === "open") {
      const msLeft = new Date(closesAt).getTime() - now;
      if (msLeft <= 0) return null;
      const hoursLeft = msLeft / (60 * 60 * 1000);
      if (hoursLeft <= 24) return m.assignmentDetail_metaDueTonight();
      return m.assignmentDetail_metaDaysLeft({ count: Math.ceil(hoursLeft / 24) });
    }
    if (status === "upcoming") {
      const msUntil = new Date(opensAt).getTime() - now;
      if (msUntil <= 0) return null;
      return m.assignmentDetail_metaOpensIn({
        count: Math.ceil(msUntil / (24 * 60 * 60 * 1000))
      });
    }
    if (status === "closed") return m.assignmentDetail_metaEnded();
    return null;
  }

  const badge = $derived(statusBadge(detail.status));
  const hint = $derived(urgencyHint(detail.status, detail.opensAt, detail.closesAt));

  // Student-view helpers
  function studentRowClass(
    state: "ac" | "partial" | "attempted" | "none" | null
  ): string {
    if (state === "ac") {
      return "bg-success/[0.08] border-success/25 hover:bg-success/[0.12] hover:border-success/40";
    }
    if (state === "partial") {
      return "bg-destructive/[0.06] border-destructive/20 hover:bg-destructive/[0.1] hover:border-destructive/35";
    }
    return "border-border hover:border-border-strong";
  }

  function letterBoxClass(
    state: "ac" | "partial" | "attempted" | "none" | null
  ): string {
    if (state === "ac") return "bg-success/[0.16] text-success border-success/30";
    if (state === "partial") return "bg-destructive/[0.12] text-destructive border-destructive/25";
    return "bg-muted text-muted-foreground border-border";
  }

  function difficultyClass(difficulty: "easy" | "medium" | "hard"): string {
    if (difficulty === "easy") return "text-success";
    if (difficulty === "medium") return "text-warning";
    return "text-destructive";
  }

  function verdictLabel(status: string): string {
    const normalized = status.toUpperCase();
    if (status === "accepted") return "AC";
    if (status === "wrong_answer") return "WA";
    if (status === "time_limit_exceeded") return "TLE";
    if (status === "memory_limit_exceeded") return "MLE";
    if (status === "runtime_error") return "RE";
    if (status === "compile_error") return "CE";
    return normalized;
  }

  function verdictClass(status: string): string {
    if (status === "accepted") return "text-success font-semibold";
    if (status === "wrong_answer" || status === "runtime_error" || status === "compile_error")
      return "text-destructive font-semibold";
    if (status === "time_limit_exceeded" || status === "memory_limit_exceeded")
      return "text-warning font-semibold";
    return "text-muted-foreground";
  }

  // After close, drop assignment context so the problem opens as practice
  // (no attempt counting, no scoreboard write).
  function problemHref(problemId: string): string {
    if (detail.status === "closed") {
      return `/problems/${problemId}`;
    }
    return `/assignments/${detail.id}/problems/${problemId}`;
  }
</script>

<div class="space-y-6 pb-20">
  {#snippet assignmentMeta()}
    <Badge variant={badge.variant} dot={badge.dot} size="sm">{badge.label}</Badge>
    <span
      class="inline-block size-[3px] shrink-0 rounded-full bg-muted-foreground"
      aria-hidden="true"
    ></span>
    <span class="font-mono tabular-nums"
      >{formatTimeRangeCompact(detail.opensAt, detail.closesAt)}</span
    >
    {#if hint}
      <span
        class="inline-block size-[3px] shrink-0 rounded-full bg-muted-foreground"
        aria-hidden="true"
      ></span>
      <span>{hint}</span>
    {/if}
    {#if data.mode === "teacher"}
      <span
        class="inline-block size-[3px] shrink-0 rounded-full bg-muted-foreground"
        aria-hidden="true"
      ></span>
      <span>{m.assignmentDetail_metaProblemCount({ count: detail.problemCount })}</span>
    {/if}
    <span
      class="inline-block size-[3px] shrink-0 rounded-full bg-muted-foreground"
      aria-hidden="true"
    ></span>
    <span>
      {#if detail.maxAttemptsPerDay}
        {m.assignmentDetail_metaAttemptsPerDay({ count: detail.maxAttemptsPerDay })}
      {:else}
        {m.assignmentDetail_metaAttemptsUnlimited()}
      {/if}
    </span>
  {/snippet}

  {#snippet assignmentActions()}
    <Button
      variant="outline"
      size="sm"
      type="button"
      onclick={() => (showOverrideDrawer = true)}
    >
      {m.override_staff_buttonLabel()}
    </Button>
  {/snippet}

  <PageHero
    variant="workspace"
    breadcrumbHref={`/courses/${data.course.id}`}
    breadcrumbLabel={m.assignmentShell_backToCourse({ course: data.course.title })}
    eyebrow={m.assignmentDetail_eyebrow()}
    title={detail.title}
    meta={assignmentMeta}
    actions={canSetOverride ? assignmentActions : undefined}
  />

  {#if data.mode === "student"}
    <!-- ══════ STUDENT VIEW ══════ -->
    <section class="animate-in animate-in-1">
      <div class="mb-4 flex items-baseline justify-between gap-4">
        <h2 class="font-display text-title font-medium leading-tight">
          {m.assignmentDetail_studentProblemsHeading()}
        </h2>
        <span class="text-caption text-muted-foreground">
          {m.assignmentDetail_studentProblemsLegend()}
        </span>
      </div>

      {#if detail.status === "upcoming"}
        <div
          class="rounded-2xl border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-8 py-12 text-center"
        >
          <p class="text-body-lg font-medium text-foreground">
            {m.assignmentDetail_studentProblemsLockedTitle()}
          </p>
          <p class="mt-2 text-body-sm text-muted-foreground">
            {m.assignmentDetail_studentProblemsLockedHint({
              when: formatDateTimeCompact(detail.opensAt)
            })}
          </p>
        </div>
      {:else}
      <div class="grid gap-3">
        {#each detail.problems as problem (problem.problemId)}
          {@const state = problem.myStatus?.state ?? "none"}
          {#snippet rowBody()}
            <div
              class={cn(
                "flex h-[42px] w-[42px] items-center justify-center rounded-md border font-display text-title-sm font-medium",
                letterBoxClass(state)
              )}
            >
              {problem.letter}
            </div>

            <div class="min-w-0">
              <div class="text-body-lg font-semibold tracking-[-0.01em]">{problem.title}</div>
              <div
                class="mt-1.5 flex flex-wrap items-center gap-3 text-caption text-muted-foreground"
              >
                <span
                  class={cn(
                    "text-micro font-semibold uppercase tracking-[0.1em]",
                    difficultyClass(problem.difficulty)
                  )}
                >
                  {problem.difficulty}
                </span>
                {#if problem.myStatus?.lastSubmissionAt}
                  <span>
                    {m.assignmentDetail_studentLastSubmission({
                      when: formatDateTimeCompact(problem.myStatus.lastSubmissionAt)
                    })}
                  </span>
                  <span>
                    {m.assignmentDetail_studentAttempts({
                      count: problem.myStatus?.attempts ?? 0
                    })}
                  </span>
                {:else}
                  <span>{m.assignmentDetail_studentNotSubmitted()}</span>
                {/if}
              </div>
            </div>

            <div
              class="flex items-center gap-1.5 font-display text-title font-medium tabular-nums leading-none"
            >
              <span>{problem.myStatus?.bestScore ?? 0}</span>
              <span class="text-body-sm font-normal text-muted-foreground">
                / {problem.points}
              </span>
              {#if problem.myStatus?.overridden}
                <span
                  class="inline-flex items-center text-info"
                  title={m.override_student_markerTooltip()}
                  aria-label={m.override_student_marker()}
                >
                  <Info class="size-4" aria-hidden="true" />
                </span>
              {/if}
            </div>

            {#if !data.course.archived}
              <ChevronRight class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            {:else}
              <span class="size-5 shrink-0" aria-hidden="true"></span>
            {/if}
          {/snippet}

          {#if data.course.archived}
            <div
              class={cn(
                "grid grid-cols-[auto_1fr_auto_auto] items-center gap-5 rounded-2xl border bg-[color:var(--color-panel)] px-6 py-5 text-foreground",
                studentRowClass(state)
              )}
              aria-disabled="true"
            >
              {@render rowBody()}
            </div>
          {:else}
            <a
              href={problemHref(problem.problemId)}
              class={cn(
                "group grid grid-cols-[auto_1fr_auto_auto] items-center gap-5 rounded-2xl border bg-[color:var(--color-panel)] px-6 py-5 no-underline text-foreground transition-[transform,background-color,border-color,box-shadow] duration-fast ease-out-soft hover:translate-x-[3px] hover:shadow-rest",
                studentRowClass(state)
              )}
            >
              {@render rowBody()}
            </a>
          {/if}
        {/each}
      </div>
      {/if}
    </section>

    <section class="animate-in animate-in-2 mt-10">
      <h3 class="font-display text-title font-medium leading-tight">
        {m.assignmentDetail_studentSubmissionLogHeading()}
      </h3>
      <p class="mt-1 mb-4 text-body-sm text-muted-foreground">
        {m.assignmentDetail_studentSubmissionLogHint()}
      </p>

      {#if !detail.myRecentSubmissions || detail.myRecentSubmissions.length === 0}
        <div
          class="rounded-lg border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-8 py-12 text-center text-body-sm text-muted-foreground"
        >
          {m.assignmentDetail_studentNoSubmissions()}
        </div>
      {:else}
        <div
          class="overflow-hidden rounded-lg border border-border bg-muted/10 font-mono text-body-sm"
        >
          {#each detail.myRecentSubmissions as entry (entry.id)}
            <a
              href={`/submissions/${entry.id}`}
              class="grid grid-cols-[120px_1fr_auto_auto_auto] items-center gap-4 border-b border-border-subtle px-5 py-3 text-inherit no-underline last:border-b-0 hover:bg-[color:var(--color-panel)]/50"
            >
              <span class="text-muted-foreground"
                >{formatDateTimeCompact(entry.createdAt)}</span
              >
              <span class="truncate"
                ><span class="font-display text-foreground">{entry.problemLetter}</span>
                · {entry.problemTitle}</span
              >
              <span class={verdictClass(entry.status)}>{verdictLabel(entry.status)}</span>
              <span class="tabular-nums">
                {entry.score} / 100
              </span>
              <ChevronRight
                class="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </a>
          {/each}
        </div>
      {/if}
    </section>

    {#if clarificationEnabled}
      <section class="animate-in animate-in-3 mt-10">
        <h2 class="font-display text-title font-medium leading-tight">{m.clarification_tab_title()}</h2>
        <div class="mt-4">
          <ClarificationTab
            contextType="assignment"
            contextId={detail.id}
            canAsk={data.clarification.canAsk}
            canAnswer={data.clarification.canAnswer}
            problems={clarificationProblems}
          />
        </div>
      </section>
    {/if}
  {:else}
    <!-- ══════ TEACHER VIEW ══════ -->

    <nav
      aria-label="Assignment sections"
      class="animate-in animate-in-1 mb-6 border-b border-border"
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

    <div class="animate-in animate-in-2">
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
