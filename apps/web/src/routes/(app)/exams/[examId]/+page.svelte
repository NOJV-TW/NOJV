<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/utils/css.js";
  import { ChevronRight, Pencil } from "@lucide/svelte";
  import Crumbs from "$lib/components/primitives/visual/Crumbs.svelte";
  import CornerMark from "$lib/components/primitives/visual/CornerMark.svelte";
  import DotGrid from "$lib/components/primitives/visual/DotGrid.svelte";
  import TypeIcon from "$lib/components/features/coursework/TypeIcon.svelte";
  import StatusPill from "$lib/components/features/coursework/StatusPill.svelte";
  import Countdown from "$lib/components/primitives/visual/Countdown.svelte";
  import GlassPanel from "$lib/components/primitives/visual/GlassPanel.svelte";
  import DifficultyTick from "$lib/components/primitives/visual/DifficultyTick.svelte";
  import ExamSubmissionsMatrix from "$lib/components/features/course/exam/ExamSubmissionsMatrix.svelte";
  import ExamSettingsTab from "$lib/components/features/course/exam/ExamSettingsTab.svelte";
  import ExamProblemsTab from "$lib/components/features/course/exam/ExamProblemsTab.svelte";
  import ExamProctoringTab from "$lib/components/features/course/exam/ExamProctoringTab.svelte";
  import ExamResultsTab from "$lib/components/features/course/exam/ExamResultsTab.svelte";
  import ExamStartModal from "$lib/components/features/course/exam/ExamStartModal.svelte";
  import AssignmentPlagiarismReport from "$lib/components/features/plagiarism/AssignmentPlagiarismReport.svelte";
  import AuditTimeline from "$lib/components/features/audit/AuditTimeline.svelte";
  import ScoreOverrideDrawer from "$lib/components/features/score-override/ScoreOverrideDrawer.svelte";
  import ClarificationTab from "$lib/components/features/clarification/ClarificationTab.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { fmtDate } from "$lib/utils/datetime.js";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const detail = $derived(data.detail);
  const isManager = $derived(data.isManager);

  let nowMs = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => {
      nowMs = Date.now();
    }, 1000);
    return () => clearInterval(id);
  });

  const startsAtMs = $derived(new Date(detail.startsAt).getTime());
  const endsAtMs = $derived(new Date(detail.endsAt).getTime());
  const durationMinutes = $derived(Math.max(0, Math.round((endsAtMs - startsAtMs) / 60_000)));

  type LiveStatus = "draft" | "upcoming" | "running" | "ended";
  const liveStatus: LiveStatus = $derived.by(() => {
    if (detail.status === "draft") return "draft";
    if (nowMs < startsAtMs) return "upcoming";
    if (nowMs >= endsAtMs) return "ended";
    return "running";
  });

  const past = $derived(liveStatus === "ended");

  function pillStatus(s: LiveStatus): string {
    if (s === "running") return "in_progress";
    if (s === "upcoming") return "scheduled";
    if (s === "draft") return "scheduled";
    return "ended";
  }

  const examCode = $derived(`EX-${detail.id.slice(-6).toUpperCase()}`);

  const allowedLanguages = $derived(
    detail.manager?.allowedLanguages ?? ["cpp17", "python311", "java17"],
  );

  const rules = $derived.by(() => {
    const list: string[] = [
      m.examDetail_ruleProctorTabSwitch(),
      m.examDetail_ruleAllowedLanguagesOnly(),
      m.examDetail_ruleAutosaveAndAutosubmit(),
    ];
    if (detail.pageLockEnabled) {
      list.push(m.examDetail_ruleFullscreenLock());
    }
    if (detail.ipBindingEnabled) {
      list.push(
        detail.ipViolationMode === "block"
          ? m.examDetail_ruleIpBindingBlock()
          : m.examDetail_ruleIpBindingNotify(),
      );
    }
    if (detail.ipWhitelistEnabled) {
      list.push(m.examDetail_ruleIpWhitelist({ count: detail.ipWhitelistCount }));
    }
    list.push(m.examDetail_ruleAskClarifications());
    return list;
  });

  let showStartModal = $state(false);

  type SubTab =
    | "problems"
    | "submissions"
    | "results"
    | "plagiarism"
    | "proctoring"
    | "settings"
    | "clarifications"
    | "audit";
  let activeSubTabKey = $state<SubTab>("problems");

  const subTabs = $derived<{ key: SubTab; label: string }[]>([
    { key: "problems", label: m.examDetail_subTabProblems() },
    { key: "submissions", label: m.examDetail_subTabSubmissions() },
    { key: "results", label: m.examDetail_subTabResults() },
    { key: "plagiarism", label: m.examDetail_subTabPlagiarism() },
    { key: "proctoring", label: m.examDetail_subTabProctoring() },
    { key: "settings", label: m.examDetail_subTabSettings() },
    ...(data.clarification.canView
      ? [{ key: "clarifications" as const, label: m.clarification_tab_title() }]
      : []),
    { key: "audit", label: m.examDetail_subTabAudit() },
  ]);

  const studentPrepRules = $derived([
    m.examDetail_studentPrepRule1(),
    m.examDetail_studentPrepRule2(),
    m.examDetail_studentPrepRule3(),
  ]);

  const clarificationProblems = $derived(
    detail.problems.map((p) => ({ id: p.id, title: p.title })),
  );

  const feedbackByProblem = $derived(
    new Map((data.feedback ?? []).map((f) => [f.problemId, f.comment])),
  );

  let showOverrideDrawer = $state(false);
  let overridePrefill = $state<{ userId: string; problemId: string } | null>(null);
  const canSetOverride = $derived(data.canSetOverride ?? false);

  function gradeCell(userId: string, problemId: string) {
    overridePrefill = { userId, problemId };
    showOverrideDrawer = true;
  }
  const overrideStudents = $derived(
    data.matrix
      ? data.matrix.rows.map((r) => ({
          id: r.userId,
          username: r.handle,
          name: r.displayName,
        }))
      : [],
  );
  const overrideProblems = $derived(detail.problems.map((p) => ({ id: p.id, title: p.title })));

  function rowTint(state: "ac" | "partial" | "zero" | "empty" | null): string {
    if (state === "ac") return "bg-success/[0.06]";
    if (state === "partial")
      return "bg-[color:color-mix(in_oklab,var(--chart-4)_8%,transparent)]";
    return "";
  }
</script>

<PageContainer class="space-y-6 fade-up">
  <Crumbs items={[{ label: m.navigation_exams(), href: "/exams" }, { label: examCode }]} />

  <div
    class="relative overflow-hidden rounded-xl border-2 shadow-rest"
    style="border-color: var(--border); background: var(--panel);"
  >
    <CornerMark pos="tl" />
    <CornerMark pos="tr" />
    <CornerMark pos="bl" />
    <CornerMark pos="br" />
    <DotGrid opacity={0.12} />

    <div class="relative p-7 lg:p-10">
      <div class="flex flex-wrap items-start justify-between gap-6">
        <div class="min-w-0">
          <div
            class="flex items-center gap-2 font-mono text-micro uppercase tracking-[0.2em] text-muted-foreground"
          >
            <TypeIcon kind="exam" size={14} />
            <span>{m.examDetail_typeLabel()}</span>
            <span class="opacity-60">|</span>
            <span>{examCode}</span>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <StatusPill status={pillStatus(liveStatus)} type="exam" />
            {#if past && !isManager && detail.viewerScore !== null}
              <div
                class="flex items-baseline gap-1.5 rounded-full px-3 py-1 font-mono text-caption tabular-nums"
                style="background: color-mix(in oklab, var(--primary) 10%, transparent);"
              >
                <span class="text-micro uppercase tracking-wider text-muted-foreground"
                  >{m.examDetail_scoreLabel()}</span
                >
                <span class="font-semibold" style="color: var(--primary);">
                  {detail.viewerScore}
                </span>
                <span class="text-muted-foreground">/ {detail.totalPoints}</span>
              </div>
            {/if}
          </div>
          <h1 class="mt-3 text-headline font-semibold tracking-tight lg:text-display">
            {detail.title}
          </h1>
          {#if detail.summary}
            <p class="mt-4 max-w-2xl text-body text-muted-foreground">{detail.summary}</p>
          {/if}
        </div>

        <div
          class="min-w-[260px] rounded-lg border border-dashed p-3"
          style="border-color: var(--border-strong);"
        >
          <div class="font-mono text-micro uppercase tracking-[0.18em] text-muted-foreground">
            {past
              ? m.examDetail_clockHeld()
              : liveStatus === "running"
                ? m.examDetail_clockRunning()
                : m.examDetail_clockUntilStart()}
          </div>
          <div class="mt-2">
            {#if past}
              <div class="font-mono text-title">{fmtDate(detail.startsAt)}</div>
            {:else if liveStatus === "running"}
              <Countdown iso={detail.endsAt} />
            {:else}
              <Countdown iso={detail.startsAt} />
            {/if}
          </div>
          <div class="mt-3 space-y-1 border-t border-border-subtle pt-3 font-mono text-caption">
            <div class="flex justify-between">
              <span class="text-muted-foreground">{m.examDetail_clockStartsLabel()}</span>
              <span>{fmtDate(detail.startsAt)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">{m.examDetail_clockEndsLabel()}</span>
              <span>{fmtDate(detail.endsAt)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">{m.examDetail_clockDurationLabel()}</span>
              <span>{m.examDetail_durationMinutes({ count: durationMinutes })}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  {#if form?.error}
    <div
      role="alert"
      class="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-body-sm text-warning"
    >
      {form.error}
    </div>
  {/if}

  {#if !isManager}
    {#if past}
      <GlassPanel class="p-5">
        <div class="mb-2 flex items-center justify-between">
          <div
            class="flex items-center gap-2 font-mono text-micro uppercase tracking-wider text-muted-foreground"
          >
            <span class="size-1.5 rounded-full bg-primary"></span>
            <span>{m.examDetail_rulesNoteLabel()}</span>
          </div>
        </div>
        <p class="text-body-sm text-muted-foreground">
          {m.examDetail_rulesNoteSummary({
            problems: detail.problems.length,
            minutes: durationMinutes,
            points: detail.totalPoints,
            languages: allowedLanguages.join(" / "),
          })}
        </p>
      </GlassPanel>

      <GlassPanel class="overflow-hidden">
        <div class="flex items-center justify-between border-b border-border-subtle px-6 py-4">
          <h2 class="text-title font-semibold">{m.examDetail_studentProblemsHeading()}</h2>
          <span
            class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-micro uppercase tracking-wider"
            style="background: var(--muted); color: var(--muted-foreground);"
          >
            <span class="size-1.5 rounded-full" style="background: var(--muted-foreground);"
            ></span>
            {m.examDetail_endedPill()}
          </span>
        </div>
        <div class="divide-y" style="border-color: var(--border-subtle);">
          {#each detail.problems as p (p.id)}
            {@const verdict = p.viewerState ?? "empty"}
            {@const feedbackComment = feedbackByProblem.get(p.id)}
            <a
              href={`/problems/${p.id}`}
              class={cn(
                "grid grid-cols-[60px_1fr_auto_auto_auto] items-center gap-4 px-6 py-3.5 text-inherit no-underline transition-colors hover:bg-muted/40",
                rowTint(p.viewerState),
              )}
            >
              <div class="font-mono text-body font-semibold text-muted-foreground">
                {p.letter}
              </div>
              <div>
                <div class="font-medium">{p.title}</div>
                <div class="mt-1 flex items-center gap-3">
                  <DifficultyTick level={p.difficulty} />
                </div>
              </div>
              <div class="hidden sm:block">
                {#if verdict === "ac"}
                  <span
                    class="verdict-ac inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-caption uppercase tracking-wider"
                  >
                    AC
                  </span>
                {:else if verdict === "partial"}
                  <span
                    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-caption uppercase tracking-wider"
                    style="background: color-mix(in oklab, var(--chart-4) 22%, transparent); color: oklch(0.55 0.13 70);"
                  >
                    Partial
                  </span>
                {:else if verdict === "zero"}
                  <span
                    class="font-mono text-caption uppercase tracking-wider text-muted-foreground"
                    >0 / {p.points}</span
                  >
                {:else}
                  <span
                    class="font-mono text-caption uppercase tracking-wider text-muted-foreground"
                    >—</span
                  >
                {/if}
              </div>
              <div class="w-20 text-right font-mono text-body-sm tabular-nums">
                <span class={verdict === "ac" ? "font-semibold" : "text-muted-foreground"}>
                  {p.points}
                </span>
              </div>
              <span
                class="inline-flex items-center gap-1 font-mono text-caption uppercase tracking-wider text-muted-foreground"
              >
                {m.examDetail_problemPreview()}
                <ChevronRight aria-hidden="true" class="size-3.5" />
              </span>
            </a>
            {#if feedbackComment}
              <div class="px-6 pb-3.5 pt-1">
                <div class="rounded-md border border-info/30 bg-info/5 px-3 py-2">
                  <div class="font-mono text-micro uppercase tracking-wider text-info">
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
      </GlassPanel>

      {#if data.clarification.canView}
        <GlassPanel class="p-7">
          <header class="mb-4">
            <h2 class="text-title font-medium">{m.clarification_tab_title()}</h2>
          </header>
          <ClarificationTab
            contextType="exam"
            contextId={detail.id}
            canAsk={data.clarification.canAsk}
            canAnswer={data.clarification.canAnswer}
            problems={clarificationProblems}
          />
        </GlassPanel>
      {/if}
    {:else}
      <div class="grid gap-6 lg:grid-cols-[1fr_360px]">
        <GlassPanel class="p-7">
          <div class="flex items-start justify-between gap-3">
            <h2 class="flex items-center gap-2 text-title font-semibold">
              <span class="size-1.5 rounded-full bg-primary"></span>
              {m.examDetail_studentRulesHeading()}
            </h2>
          </div>
          <ul class="mt-4 space-y-2.5">
            {#each rules as r, i (i)}
              <li class="flex items-start gap-3 text-body-sm">
                <span
                  class="mt-0.5 font-mono text-micro uppercase tracking-wider tabular-nums text-muted-foreground"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{r}</span>
              </li>
            {/each}
          </ul>

          <div class="mt-6 border-t border-border-subtle pt-5">
            <div
              class="mb-2 font-mono text-micro uppercase tracking-wider text-muted-foreground"
            >
              {m.examDetail_studentAllowedLanguagesHeading()}
            </div>
            <div class="flex flex-wrap gap-2">
              {#each allowedLanguages as l (l)}
                <span
                  class="rounded-full bg-muted px-2.5 py-1 font-mono text-caption text-muted-foreground"
                  >{l}</span
                >
              {/each}
            </div>
          </div>
        </GlassPanel>

        <GlassPanel class="flex flex-col gap-4 p-6">
          <div>
            <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
              {m.examDetail_studentPrepEyebrow()}
            </div>
            <h3 class="mt-1 text-title font-semibold">{m.examDetail_studentPrepHeading()}</h3>
          </div>
          <ul class="space-y-2 text-body-sm">
            {#each studentPrepRules as rule (rule)}
              <li class="flex items-start gap-2">
                <span
                  class="mt-0.5 inline-flex size-4 items-center justify-center rounded-full"
                  style="background: color-mix(in oklab, var(--success) 18%, transparent); color: oklch(0.45 0.13 160);"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"><polyline points="20 6 9 17 4 12" /></svg
                  >
                </span>
                <span>{rule}</span>
              </li>
            {/each}
          </ul>
          <button
            type="button"
            disabled={liveStatus !== "running"}
            onclick={() => (showStartModal = true)}
            class="mt-auto w-full rounded-md bg-primary px-4 py-3 text-body font-semibold text-primary-foreground transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {m.examDetail_studentStartButton()}
          </button>
          <p class="text-center text-caption text-muted-foreground">
            {#if liveStatus === "running"}
              {m.examDetail_studentStartHintRunning()}
            {:else if liveStatus === "upcoming"}
              {m.examDetail_studentStartHintUpcoming()}
            {:else}
              {m.examDetail_studentStartHintNotOpen()}
            {/if}
          </p>
        </GlassPanel>
      </div>

      {#if data.clarification.canView}
        <GlassPanel class="p-7">
          <header class="mb-4">
            <h2 class="text-title font-medium">{m.clarification_tab_title()}</h2>
          </header>
          <ClarificationTab
            contextType="exam"
            contextId={detail.id}
            canAsk={data.clarification.canAsk}
            canAnswer={data.clarification.canAnswer}
            problems={clarificationProblems}
          />
        </GlassPanel>
      {/if}
    {/if}
  {:else}
    <GlassPanel class="p-5">
      <div class="mb-2 flex items-center justify-between">
        <div
          class="flex items-center gap-2 font-mono text-micro uppercase tracking-wider text-muted-foreground"
        >
          <span class="size-1.5 rounded-full bg-primary"></span>
          <span>{m.examDetail_rulesNoteLabel()}</span>
        </div>
        <button
          type="button"
          onclick={() => (activeSubTabKey = "settings")}
          class="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 text-caption font-medium transition-colors hover:border-border"
        >
          <Pencil aria-hidden="true" class="size-3" />
          {m.examDetail_managerEditButton()}
        </button>
      </div>
      <p class="text-body-sm text-muted-foreground">
        {m.examDetail_rulesNoteSummary({
          problems: detail.problems.length,
          minutes: durationMinutes,
          points: detail.totalPoints,
          languages: allowedLanguages.join(" / "),
        })}
        {#if detail.pageLockEnabled || detail.ipBindingEnabled || detail.ipWhitelistEnabled}
          {m.examDetail_rulesNoteEnabledFeatures({
            features: [
              detail.pageLockEnabled ? m.examDetail_featurePageLock() : null,
              detail.ipBindingEnabled ? m.examDetail_featureIpBinding() : null,
              detail.ipWhitelistEnabled ? m.examDetail_featureIpWhitelist() : null,
            ]
              .filter(Boolean)
              .join(m.examDetail_featuresSeparator()),
          })}
        {/if}
      </p>
    </GlassPanel>

    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        onclick={() => (activeSubTabKey = "results")}
        class="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-[color:var(--color-panel)]/60 px-3 py-2 text-caption font-medium transition-colors hover:border-border"
      >
        {m.examDetail_managerClassResultsLink()}
      </button>
      <button
        type="button"
        onclick={() => (activeSubTabKey = "submissions")}
        class="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-[color:var(--color-panel)]/60 px-3 py-2 text-caption font-medium transition-colors hover:border-border"
      >
        {m.examDetail_managerSubmissionMatrixLink()}
      </button>
      {#if canSetOverride}
        {#if past}
          <button
            type="button"
            onclick={() => (showOverrideDrawer = true)}
            class="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-[color:var(--color-panel)]/60 px-3 py-2 text-caption font-medium transition-colors hover:border-border"
          >
            {m.grading_openButton()}
          </button>
        {:else}
          <span class="inline-flex items-center px-1 py-2 text-caption text-muted-foreground">
            {m.grading_availableAfterClose()}
          </span>
        {/if}
      {/if}
    </div>

    <div
      role="tablist"
      aria-label={m.examDetail_subTabsLabel()}
      class="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-[color:var(--color-panel)]/60 p-1"
    >
      {#each subTabs as tab (tab.key)}
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTabKey === tab.key}
          onclick={() => (activeSubTabKey = tab.key)}
          class="rounded-md px-3.5 py-1.5 text-body-sm font-medium transition-colors {activeSubTabKey ===
          tab.key
            ? 'bg-[color:var(--color-primary)]/14 text-primary'
            : 'text-muted-foreground hover:text-foreground'}"
        >
          {tab.label}
        </button>
      {/each}
    </div>

    {#if activeSubTabKey === "submissions" && data.matrix}
      <GlassPanel class="p-5">
        <ExamSubmissionsMatrix
          matrix={data.matrix}
          examId={detail.id}
          oncellclick={canSetOverride ? gradeCell : undefined}
        />
      </GlassPanel>
    {:else if activeSubTabKey === "results" && data.results}
      <GlassPanel class="p-5">
        <ExamResultsTab data={data.results} />
      </GlassPanel>
    {:else if activeSubTabKey === "plagiarism"}
      <GlassPanel class="p-5">
        <AssignmentPlagiarismReport
          report={data.plagiarism}
          flags={data.plagiarismFlags ?? []}
          diffContext={{ type: "exam", id: detail.id }}
          problems={detail.problems.map((p) => ({
            problemId: p.id,
            letter: p.letter,
            title: p.title,
          }))}
          students={data.matrix
            ? data.matrix.rows.map((r) => ({
                userId: r.userId,
                displayName: r.displayName,
                handle: r.handle,
              }))
            : []}
        />
      </GlassPanel>
    {:else if activeSubTabKey === "proctoring"}
      <GlassPanel class="p-5">
        <ExamProctoringTab
          violations={data.ipViolations ?? []}
          activeSessions={data.activeSessions ?? []}
        />
      </GlassPanel>
    {:else if activeSubTabKey === "settings" && data.settingsForm}
      <ExamSettingsTab form={data.settingsForm} {detail} {liveStatus} />
    {:else if activeSubTabKey === "clarifications"}
      <GlassPanel class="p-5">
        <ClarificationTab
          contextType="exam"
          contextId={detail.id}
          canAsk={data.clarification.canAsk}
          canAnswer={data.clarification.canAnswer}
          problems={clarificationProblems}
        />
      </GlassPanel>
    {:else if activeSubTabKey === "audit"}
      <GlassPanel class="p-5">
        <AuditTimeline events={data.auditEvents} actorNames={data.auditActorNames} />
      </GlassPanel>
    {:else}
      <ExamProblemsTab
        {detail}
        {liveStatus}
        canEdit={liveStatus === "draft" || liveStatus === "upcoming"}
        {form}
      />
    {/if}
  {/if}
</PageContainer>

{#if !isManager && !past}
  <ExamStartModal
    open={showStartModal}
    onOpenChange={(v) => (showStartModal = v)}
    examTitle={detail.title}
    problemCount={detail.problems.length}
    firstProblemId={detail.problems[0]?.id}
    {durationMinutes}
  />
{/if}

{#if canSetOverride}
  <ScoreOverrideDrawer
    open={showOverrideDrawer}
    onOpenChange={(v) => {
      showOverrideDrawer = v;
      if (!v) overridePrefill = null;
    }}
    contextType="exam"
    contextId={detail.id}
    students={overrideStudents}
    problems={overrideProblems}
    prefill={overridePrefill}
  />
{/if}
