<script lang="ts">
  import { ChevronRight, Info } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/utils/css.js";
  import { formatDateTimeCompact } from "$lib/utils/datetime";
  import AssignmentProblemsTab from "$lib/components/features/course/assignment/AssignmentProblemsTab.svelte";
  import AssignmentSubmissionsMatrix from "$lib/components/features/course/assignment/AssignmentSubmissionsMatrix.svelte";
  import AssignmentResultsTab from "$lib/components/features/course/assignment/AssignmentResultsTab.svelte";
  import AssignmentPlagiarismReport from "$lib/components/features/plagiarism/AssignmentPlagiarismReport.svelte";
  import AssignmentSettingsTab from "$lib/components/features/course/assignment/AssignmentSettingsTab.svelte";
  import AuditTimeline from "$lib/components/features/audit/AuditTimeline.svelte";
  import { Button } from "$lib/components/primitives/ui/button";
  import { Tabs } from "$lib/components/primitives/ui/tabs";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import ScoreOverrideDrawer from "$lib/components/features/score-override/ScoreOverrideDrawer.svelte";
  import ClarificationTab from "$lib/components/features/clarification/ClarificationTab.svelte";
  import Crumbs from "$lib/components/primitives/visual/Crumbs.svelte";
  import GlassPanel from "$lib/components/primitives/visual/GlassPanel.svelte";
  import AssessmentHero from "$lib/components/features/coursework/AssessmentHero.svelte";
  import HeroSchedule from "$lib/components/features/coursework/HeroSchedule.svelte";
  import StatRail from "$lib/components/primitives/visual/StatRail.svelte";
  import StatTile from "$lib/components/primitives/visual/StatTile.svelte";
  import StatusPill from "$lib/components/features/coursework/StatusPill.svelte";
  import Countdown from "$lib/components/primitives/visual/Countdown.svelte";
  import DifficultyTick from "$lib/components/primitives/visual/DifficultyTick.svelte";
  import { deriveAssignmentLiveStatus } from "$lib/utils/assignment-status";
  import { languageLabel } from "@nojv/core";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const detail = $derived(data.detail);

  type SubTabKey =
    | "problems"
    | "submissions"
    | "results"
    | "plagiarism"
    | "settings"
    | "clarifications"
    | "audit";
  let activeSubTab = $state<SubTabKey>("submissions");

  const clarificationProblems = $derived(
    detail.problems.map((p) => ({ id: p.problemId, title: p.title })),
  );
  const clarificationEnabled = $derived(data.clarification.canView);

  const feedbackByProblem = $derived(
    new Map(
      (data.mode === "student" ? data.feedback : []).map((f) => [f.problemId, f.comment]),
    ),
  );

  let showOverrideDrawer = $state(false);
  let overridePrefill = $state<{ userId: string; problemId: string } | null>(null);
  const canSetOverride = $derived(
    data.mode === "teacher" ? (data.canSetOverride ?? false) : false,
  );

  function gradeCell(userId: string, problemId: string) {
    overridePrefill = { userId, problemId };
    showOverrideDrawer = true;
  }
  const assignmentClosed = $derived(detail.status === "closed");
  const overrideStudents = $derived(
    data.mode === "teacher"
      ? data.matrix.rows.map((r) => ({
          id: r.userId,
          username: r.handle,
          name: r.displayName,
        }))
      : [],
  );
  const overrideProblems = $derived(
    data.mode === "teacher"
      ? detail.problems.map((p) => ({ id: p.problemId, title: p.title }))
      : [],
  );

  const subTabs: { key: SubTabKey; label: string; count?: number }[] = $derived([
    { key: "problems", label: m.assignmentDetail_tabProblems() },
    data.mode === "teacher"
      ? {
          key: "submissions",
          label: m.assignmentDetail_tabSubmissions(),
          count: data.matrix.studentCount,
        }
      : { key: "submissions", label: m.assignmentDetail_tabSubmissions() },
    { key: "results", label: m.assignmentDetail_tabResults() },
    { key: "plagiarism", label: m.assignmentDetail_tabPlagiarism() },
    { key: "settings", label: m.assignmentDetail_tabSettings() },
    ...(clarificationEnabled
      ? [{ key: "clarifications" as const, label: m.clarification_tab_title() }]
      : []),
    { key: "audit", label: m.assignmentDetail_tabAudit() },
  ]);

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

  function rowTint(state: "ac" | "partial" | "attempted" | "none"): string {
    if (state === "ac") return "bg-success/[0.06]";
    if (state === "partial")
      return "bg-[color:color-mix(in_oklab,var(--chart-4)_8%,transparent)]";
    if (state === "attempted") return "bg-muted/30";
    return "";
  }

  const solved = $derived(detail.problems.filter((p) => p.myStatus?.state === "ac").length);
  const myScore = $derived(
    detail.problems.reduce((sum, p) => sum + (p.myStatus?.bestScore ?? 0), 0),
  );
  const pct = $derived(
    detail.problemCount > 0 ? Math.round((solved / detail.problemCount) * 100) : 0,
  );

  const status = $derived.by(() => {
    switch (detail.status) {
      case "upcoming":
        return "not_started";
      case "open":
        return "in_progress";
      case "closed":
        return "closed";
      case "draft":
      default:
        return "not_started";
    }
  });

  function problemHref(problemId: string): string {
    if (detail.status === "closed") {
      return `/problems/${problemId}`;
    }
    return `/assignments/${detail.id}/problems/${problemId}`;
  }

  const targetIso = $derived(detail.dueAt ?? detail.closesAt);
</script>

{#snippet gradingActions()}
  {#if assignmentClosed}
    <Button
      variant="outline"
      size="sm"
      type="button"
      onclick={() => (showOverrideDrawer = true)}
    >
      {m.grading_openButton()}
    </Button>
  {:else}
    <p class="text-caption text-muted-foreground">
      {m.grading_availableAfterClose()}
    </p>
  {/if}
{/snippet}

<PageContainer class="space-y-6 fade-up">
  <Crumbs
    items={[
      { label: m.navigation_assignments(), href: "/assignments" },
      { label: detail.title },
    ]}
  />

  <AssessmentHero
    kind="assignment"
    typeLabel={m.assignmentDetail_typeLabel()}
    context={data.course.title}
    title={detail.title}
    summary={detail.summary}
    actions={data.mode === "teacher" && canSetOverride ? gradingActions : undefined}
  >
    {#snippet aside(accent)}
      {#if detail.opensAt && targetIso}
        <HeroSchedule
          {accent}
          startIso={detail.opensAt}
          endIso={targetIso}
          startLabel={m.schedule_opens()}
          endLabel={m.schedule_closes()}
        />
      {/if}
    {/snippet}
    {#snippet badges()}
      <StatusPill {status} type="assignment" />
      {#if data.mode === "teacher"}
        <span
          class="inline-flex items-center rounded-full px-2.5 py-1 text-micro font-mono uppercase tracking-wider"
          style="background: color-mix(in oklab, var(--info) 12%, transparent); color: var(--info);"
        >
          {m.assignmentDetail_managerViewBadge()}
        </span>
      {/if}
    {/snippet}
  </AssessmentHero>

  <StatRail>
    <StatTile
      label={detail.dueAt ? m.assignmentDetail_metaDueAt() : m.assignmentDetail_metaClosesAt()}
    >
      {#snippet value()}<Countdown iso={targetIso} />{/snippet}
    </StatTile>
    <StatTile label={m.assignmentDetail_metaProgress()}>
      {#snippet value()}
        {solved}<span class="text-muted-foreground"
          >/{m.assignmentDetail_problemsCountWithUnit({ count: detail.problemCount })}</span
        >
      {/snippet}
    </StatTile>
    <StatTile label={m.assignmentDetail_metaScore()}>
      {#snippet value()}
        {myScore}<span class="text-muted-foreground">/{detail.totalPoints}</span>
      {/snippet}
    </StatTile>
    <StatTile label={m.assignmentDetail_metaAllowedLanguages()}>
      {#snippet value()}
        <span class="text-title-sm">
          {#if detail.allowedLanguages.length > 0}
            {detail.allowedLanguages.map(languageLabel).join(" / ")}
          {:else}
            {m.assignmentDetail_metaAttemptsUnlimited2()}
          {/if}
        </span>
      {/snippet}
    </StatTile>
  </StatRail>

  {#if data.mode === "student"}
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
              when: formatDateTimeCompact(detail.opensAt),
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
            {@const state = problem.myStatus?.state ?? "none"}
            {@const isSolved = state === "ac"}
            {@const tries = problem.myStatus?.attempts ?? 0}
            {@const score = problem.myStatus?.bestScore ?? 0}
            {@const feedbackComment = feedbackByProblem.get(problem.problemId)}
            {#snippet rowBody()}
              <div class="font-mono text-body font-semibold text-muted-foreground">
                {problem.letter}
              </div>
              <div class="min-w-0">
                <div class="font-medium truncate">{problem.title}</div>
                <div class="mt-1 flex items-center gap-3">
                  <DifficultyTick level={problem.difficulty} />
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
                <span
                  class="text-caption font-medium text-muted-foreground inline-flex items-center gap-1"
                >
                  {isSolved
                    ? m.assignmentDetail_problemView()
                    : m.assignmentDetail_problemSolve()}
                  <ChevronRight aria-hidden="true" class="size-3.5" />
                </span>
              {/if}
            {/snippet}
            {#if data.course.archived}
              <div
                class={cn(
                  "grid grid-cols-[60px_1fr_auto_auto] items-center gap-4 px-6 py-3.5",
                  rowTint(state),
                )}
              >
                {@render rowBody()}
              </div>
            {:else}
              <a
                href={problemHref(problem.problemId)}
                class={cn(
                  "grid grid-cols-[60px_1fr_auto_auto] items-center gap-4 px-6 py-3.5 text-inherit no-underline transition-colors hover:bg-muted/40",
                  rowTint(state),
                )}
              >
                {@render rowBody()}
              </a>
            {/if}
            {#if feedbackComment}
              <div class="px-6 pb-3.5 pt-1">
                <div class="rounded-md border border-info/30 bg-info/5 px-3 py-2">
                  <div class="text-micro font-mono uppercase tracking-wider text-info">
                    {m.feedback_student_label()}
                  </div>
                  <p class="mt-1 whitespace-pre-wrap break-words text-body-sm text-foreground">
                    {feedbackComment}
                  </p>
                </div>
              </div>
            {/if}
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
                  "inline-flex min-w-14 items-center justify-center rounded-full px-2.5 py-1 text-micro uppercase tracking-wider font-mono",
                  verdictClass(entry.status),
                )}
              >
                {verdictLabel(entry.status)}
              </span>
              <span class="whitespace-nowrap tabular-nums">
                <span class="inline-block w-8 text-right">{entry.score}</span>
                {#if entry.maxScore !== null}
                  <span class="text-muted-foreground"> / {entry.maxScore}</span>
                {/if}
              </span>
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
    <Tabs
      tabs={subTabs}
      bind:value={activeSubTab}
      label={m.assignmentDetail_sectionsNavLabel()}
      id="assignment-manage"
    >
      {#if activeSubTab === "problems"}
        <AssignmentProblemsTab
          problems={detail.problems}
          assignmentId={detail.id}
          canEdit={data.mode === "teacher" && detail.status !== "closed"}
          canRejudge={data.mode === "teacher"}
          candidateProblems={data.mode === "teacher" ? data.candidateProblems : []}
        />
      {:else if activeSubTab === "submissions"}
        <AssignmentSubmissionsMatrix
          matrix={data.matrix}
          courseId={detail.courseId}
          assignmentId={detail.id}
          oncellclick={canSetOverride ? gradeCell : undefined}
        />
      {:else if activeSubTab === "results" && data.results}
        <AssignmentResultsTab data={data.results} />
      {:else if activeSubTab === "plagiarism"}
        <AssignmentPlagiarismReport
          report={data.plagiarism}
          flags={data.plagiarismFlags ?? []}
          diffContext={{ type: "assessment", id: detail.id }}
          problems={detail.problems.map((p) => ({
            problemId: p.problemId,
            letter: p.letter,
            title: p.title,
          }))}
          students={data.matrix.rows.map((r) => ({
            userId: r.userId,
            displayName: r.displayName,
            handle: r.handle,
          }))}
        />
      {:else if activeSubTab === "settings" && data.mode === "teacher"}
        <AssignmentSettingsTab
          form={data.settingsForm}
          liveStatus={deriveAssignmentLiveStatus(
            data.assignment.status,
            detail.opensAt,
            detail.closesAt,
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
      {:else if activeSubTab === "audit" && data.mode === "teacher"}
        <AuditTimeline events={data.auditEvents} actorNames={data.auditActorNames} />
      {/if}
    </Tabs>
  {/if}
</PageContainer>

{#if canSetOverride}
  <ScoreOverrideDrawer
    open={showOverrideDrawer}
    onOpenChange={(v) => {
      showOverrideDrawer = v;
      if (!v) overridePrefill = null;
    }}
    contextType="assignment"
    contextId={detail.id}
    students={overrideStudents}
    problems={overrideProblems}
    prefill={overridePrefill}
  />
{/if}
