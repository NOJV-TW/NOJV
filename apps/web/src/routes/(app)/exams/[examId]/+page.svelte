<script lang="ts">
  import { enhance } from "$app/forms";
  import Lock from "@lucide/svelte/icons/lock";
  import Link2 from "@lucide/svelte/icons/link-2";
  import Shield from "@lucide/svelte/icons/shield";
  import Users from "@lucide/svelte/icons/users";
  import { m } from "$lib/paraglide/messages.js";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import PageHero from "$lib/components/layout/PageHero.svelte";
  import TeacherBadge from "$lib/components/common/TeacherBadge.svelte";
  import ExamSubmissionsMatrix from "$lib/components/course/exam/ExamSubmissionsMatrix.svelte";
  import ExamSettingsTab from "$lib/components/course/exam/ExamSettingsTab.svelte";
  import ExamProblemsTab from "$lib/components/course/exam/ExamProblemsTab.svelte";
  import ScoreOverrideDrawer from "$lib/components/score-override/ScoreOverrideDrawer.svelte";
  import ClarificationTab from "$lib/components/clarification/ClarificationTab.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const detail = $derived(data.detail);
  const isManager = $derived(data.isManager);

  // Re-tick once a second so the countdown copy updates without a
  // full page reload. Cleared on destroy via the runes effect contract.
  let nowMs = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => {
      nowMs = Date.now();
    }, 1000);
    return () => clearInterval(id);
  });

  const startsAtMs = $derived(new Date(detail.startsAt).getTime());
  const endsAtMs = $derived(new Date(detail.endsAt).getTime());
  const durationMinutes = $derived(
    Math.max(0, Math.round((endsAtMs - startsAtMs) / 60_000))
  );

  // Derived live status — keeps the UI honest if the user leaves the
  // page open across the start/end boundary.
  type LiveStatus = "draft" | "upcoming" | "running" | "ended" | "archived";
  const liveStatus: LiveStatus = $derived.by(() => {
    if (detail.status === "draft") return "draft";
    if (detail.status === "archived") return "archived";
    if (nowMs < startsAtMs) return "upcoming";
    if (nowMs >= endsAtMs) return "ended";
    return "running";
  });

  const canStart = $derived(liveStatus === "running");

  function pad2(n: number): string {
    return n < 10 ? `0${String(n)}` : String(n);
  }

  function formatRange(startsIso: string, endsIso: string): string {
    const s = new Date(startsIso);
    const e = new Date(endsIso);
    const md = `${s.getMonth() + 1}/${s.getDate()}`;
    return `${md} ${pad2(s.getHours())}:${pad2(s.getMinutes())} - ${pad2(e.getHours())}:${pad2(e.getMinutes())}`;
  }

  function formatStartTime(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  interface Countdown {
    days: number;
    hours: number;
    minutes: number;
  }

  // Returns positive deltas to the start (upcoming) or to the end
  // (running). Caller switches the label.
  function countdownFromMs(ms: number): Countdown {
    const total = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(total / 86_400);
    const hours = Math.floor((total % 86_400) / 3_600);
    const minutes = Math.floor((total % 3_600) / 60);
    return { days, hours, minutes };
  }

  const countdown: Countdown = $derived.by(() => {
    if (liveStatus === "upcoming") return countdownFromMs(startsAtMs - nowMs);
    if (liveStatus === "running") return countdownFromMs(endsAtMs - nowMs);
    return { days: 0, hours: 0, minutes: 0 };
  });

  function statusLabel(s: LiveStatus): string {
    if (s === "running") return m.examDetail_statusRunning();
    if (s === "ended") return m.examDetail_statusEnded();
    if (s === "draft") return m.examDetail_statusDraft();
    if (s === "archived") return m.examDetail_statusArchived();
    return m.examDetail_statusUpcoming();
  }

  function statusVariant(s: LiveStatus): "info" | "default" | "muted" {
    if (s === "running") return "default";
    if (s === "ended" || s === "draft" || s === "archived") return "muted";
    return "info";
  }

  function scoringLabel(mode: typeof detail.scoringMode): string {
    return mode === "problem_count"
      ? m.examDetail_scoringProblemCount()
      : m.examDetail_scoringPointSum();
  }

  function difficultyLabel(d: "easy" | "medium" | "hard"): string {
    if (d === "easy") return m.examDetail_difficultyEasy();
    if (d === "hard") return m.examDetail_difficultyHard();
    return m.examDetail_difficultyMedium();
  }

  type SubTab = "problems" | "submissions" | "settings" | "clarifications";
  let activeTab = $state<SubTab>("problems");

  const clarificationProblems = $derived(
    detail.problems.map((p) => ({ id: p.id, title: p.title }))
  );

  let showOverrideDrawer = $state(false);
  const canSetOverride = $derived(data.canSetOverride ?? false);
  const overrideStudents = $derived(
    data.matrix
      ? data.matrix.rows.map((r) => ({
          id: r.userId,
          username: r.handle,
          name: r.displayName
        }))
      : []
  );
  const overrideProblems = $derived(
    detail.problems.map((p) => ({ id: p.id, title: p.title }))
  );

  // The top-level `/exams` list is the breadcrumb target — the
  // id-unified exam shell no longer needs a courseId in the URL.
  const examsListHref = "/exams";

  // Pending-vs-registered split for the roster footer note.
  const pendingCount = $derived(
    detail.roster ? detail.roster.filter((r) => r.status === "registered").length : 0
  );
</script>

<div class="space-y-6 pb-20">
  {#snippet examMeta()}
    <Badge variant={statusVariant(liveStatus)} dot size="sm">
      {statusLabel(liveStatus)}
    </Badge>
    <span
      class="inline-block size-[3px] shrink-0 rounded-full bg-muted-foreground"
      aria-hidden="true"
    ></span>
    <span class="font-mono tabular-nums">
      {formatRange(detail.startsAt, detail.endsAt)}
    </span>
    <span
      class="inline-block size-[3px] shrink-0 rounded-full bg-muted-foreground"
      aria-hidden="true"
    ></span>
    <span>{m.examDetail_durationMinutes({ count: durationMinutes })}</span>
    <span
      class="inline-block size-[3px] shrink-0 rounded-full bg-muted-foreground"
      aria-hidden="true"
    ></span>
    <span>
      {#if isManager}
        {m.examDetail_problemCount({ count: detail.problems.length })} ·
      {/if}
      {scoringLabel(detail.scoringMode)}
    </span>
  {/snippet}

  {#snippet examActions()}
    {#if canSetOverride}
      <Button
        variant="outline"
        size="sm"
        type="button"
        onclick={() => (showOverrideDrawer = true)}
      >
        {m.override_staff_buttonLabel()}
      </Button>
    {/if}
    <TeacherBadge role="teacher" />
  {/snippet}

  {#snippet countdownRibbon()}
    <div
      class="countdown-card animate-in animate-in-2 grid items-center gap-8 rounded-3xl border px-10 py-10 shadow-rest"
    >
      <div>
        <div class="text-caption font-semibold uppercase tracking-[0.12em] text-primary">
          {liveStatus === "running"
            ? m.examDetail_countdownEndingLabel()
            : m.examDetail_countdownLabel()}
        </div>
        <div
          class="big mt-2.5 font-display font-normal leading-[0.95] tracking-[-0.03em] tabular-nums"
        >
          {#if liveStatus === "ended"}
            <span class="text-foreground">—</span>
            <span class="ml-2 text-[0.5em] text-muted-foreground"
              >{m.examDetail_endedNote()}</span
            >
          {:else if liveStatus === "draft"}
            <span class="text-foreground">—</span>
            <span class="ml-2 text-[0.5em] text-muted-foreground"
              >{m.examDetail_draftNote()}</span
            >
          {:else}
            {countdown.days}<span class="text-[0.5em] text-muted-foreground"
              > {m.examDetail_unitDays()}</span
            >
            {countdown.hours}<span class="text-[0.5em] text-muted-foreground"
              > {m.examDetail_unitHours()}</span
            >
            {countdown.minutes}<span class="text-[0.5em] text-muted-foreground"
              > {m.examDetail_unitMinutes()}</span
            >
          {/if}
        </div>
        <div class="mt-3 text-body text-muted-foreground">
          {m.examDetail_startTime()}<span class="font-semibold text-foreground"
            >{formatStartTime(detail.startsAt)}</span
          ><br />
          {m.examDetail_arrivalHint()}
        </div>
      </div>

      <div class="flex flex-col items-center gap-2">
        {#if isManager}
          <!-- Managers don't take the exam — show an inert pill so the
               column still has weight, matching the prototype's
               disabled visual state. -->
          <button
            type="button"
            class="start-btn"
            disabled
            aria-disabled="true"
            title={m.examDetail_managerCannotStart()}
          >
            {m.examDetail_startButton()}
          </button>
          <span class="text-caption text-muted-foreground"
            >{m.examDetail_managerCannotStart()}</span
          >
        {:else}
          <form method="POST" action="?/startExam" use:enhance class="contents">
            <button
              type="submit"
              class="start-btn"
              class:live={canStart}
              disabled={!canStart}
              aria-disabled={!canStart}
            >
              {m.examDetail_startButton()}
            </button>
          </form>
          <span class="text-caption text-muted-foreground">
            {canStart ? m.examDetail_startReady() : m.examDetail_startDisabled()}
          </span>
        {/if}
      </div>
    </div>
  {/snippet}

  <PageHero
    variant="workspace"
    breadcrumbHref={examsListHref}
    breadcrumbLabel={m.examShell_breadcrumb()}
    eyebrow={m.examDetail_eyebrow()}
    title={detail.title}
    meta={examMeta}
    actions={isManager ? examActions : undefined}
    ribbon={countdownRibbon}
  />

  {#if form?.error}
    <div
      role="alert"
      class="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-body-sm text-warning"
    >
      {form.error}
    </div>
  {/if}

  <div
    class="grid gap-5 rounded-2xl border border-border bg-[color:var(--color-panel)]/60 px-6 py-5 sm:grid-cols-2 lg:grid-cols-4"
  >
      <div class="flex items-start gap-3">
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-md bg-[color:var(--color-primary)]/14 text-primary"
        >
          <Lock class="size-4" aria-hidden="true" />
        </span>
        <div>
          <div class="text-caption text-muted-foreground tracking-[0.04em]">
            {m.examDetail_proctorPageLock()}
          </div>
          <div class="font-semibold tracking-[-0.005em]">
            {detail.pageLockEnabled ? m.examDetail_proctorOn() : m.examDetail_proctorOff()}
          </div>
        </div>
      </div>
      <div class="flex items-start gap-3">
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-md bg-[color:var(--color-primary)]/14 text-primary"
        >
          <Link2 class="size-4" aria-hidden="true" />
        </span>
        <div>
          <div class="text-caption text-muted-foreground tracking-[0.04em]">
            {m.examDetail_proctorIpBinding()}
          </div>
          <div class="font-semibold tracking-[-0.005em]">
            {#if detail.ipBindingEnabled}
              {detail.ipViolationMode === "block"
                ? m.examDetail_proctorOnBlock()
                : m.examDetail_proctorOnNotify()}
            {:else}
              {m.examDetail_proctorOff()}
            {/if}
          </div>
        </div>
      </div>
      <div class="flex items-start gap-3">
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-md bg-[color:var(--color-primary)]/14 text-primary"
        >
          <Shield class="size-4" aria-hidden="true" />
        </span>
        <div>
          <div class="text-caption text-muted-foreground tracking-[0.04em]">
            {m.examDetail_proctorIpWhitelist()}
          </div>
          <div class="font-semibold tracking-[-0.005em]">
            {#if detail.ipWhitelistEnabled}
              {m.examDetail_proctorWhitelistCount({ count: detail.ipWhitelistCount })}
            {:else}
              {m.examDetail_proctorOff()}
            {/if}
          </div>
        </div>
      </div>
      <div class="flex items-start gap-3">
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        >
          <Users class="size-4" aria-hidden="true" />
        </span>
        <div>
          <div class="text-caption text-muted-foreground tracking-[0.04em]">
            {m.examDetail_registered()}
          </div>
          <div class="font-semibold tracking-[-0.005em]">
            {detail.registeredCount} / {detail.totalStudents}
          </div>
        </div>
      </div>
    </div>

  <!-- TEACHER SUB-TABS + TWO COLUMNS -->
  {#if isManager}
    <div class="animate-in animate-in-3">
      <div
        role="tablist"
        aria-label={m.examDetail_subTabsLabel()}
        class="inline-flex items-center gap-1 rounded-xl border border-border bg-[color:var(--color-panel)]/60 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "problems"}
          onclick={() => (activeTab = "problems")}
          class="rounded-lg px-3.5 py-1.5 text-body-sm font-medium transition-colors {activeTab ===
          'problems'
            ? 'bg-[color:var(--color-primary)]/14 text-primary'
            : 'text-muted-foreground hover:text-foreground'}"
        >
          {m.examDetail_subTabProblems()}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "submissions"}
          onclick={() => (activeTab = "submissions")}
          class="rounded-lg px-3.5 py-1.5 text-body-sm font-medium transition-colors {activeTab ===
          'submissions'
            ? 'bg-[color:var(--color-primary)]/14 text-primary'
            : 'text-muted-foreground hover:text-foreground'}"
        >
          {m.examDetail_subTabSubmissions()}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "settings"}
          onclick={() => (activeTab = "settings")}
          class="rounded-lg px-3.5 py-1.5 text-body-sm font-medium transition-colors {activeTab ===
          'settings'
            ? 'bg-[color:var(--color-primary)]/14 text-primary'
            : 'text-muted-foreground hover:text-foreground'}"
        >
          {m.examDetail_subTabSettings()}
        </button>
        {#if data.clarification.canView}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "clarifications"}
            onclick={() => (activeTab = "clarifications")}
            class="rounded-lg px-3.5 py-1.5 text-body-sm font-medium transition-colors {activeTab ===
            'clarifications'
              ? 'bg-[color:var(--color-primary)]/14 text-primary'
              : 'text-muted-foreground hover:text-foreground'}"
          >
            {m.clarification_tab_title()}
          </button>
        {/if}
      </div>
    </div>

    {#if activeTab === "submissions" && data.matrix}
      <div class="animate-in animate-in-4">
        <ExamSubmissionsMatrix matrix={data.matrix} examId={detail.id} />
      </div>
    {:else if activeTab === "settings" && data.settingsForm}
      <div class="animate-in animate-in-4">
        <ExamSettingsTab
          form={data.settingsForm}
          {detail}
          {liveStatus}
        />
      </div>
    {:else if activeTab === "clarifications"}
      <div class="animate-in animate-in-4">
        <ClarificationTab
          contextType="exam"
          contextId={detail.id}
          canAsk={data.clarification.canAsk}
          canAnswer={data.clarification.canAnswer}
          problems={clarificationProblems}
        />
      </div>
    {:else}
    <div
      class="animate-in animate-in-4 grid gap-8 lg:grid-cols-[1.4fr_1fr]"
    >
      <!-- LEFT: Problems panel (editable for draft/upcoming managers) -->
      <ExamProblemsTab
        {detail}
        {liveStatus}
        canEdit={liveStatus === "draft" || liveStatus === "upcoming"}
        {form}
      />

      <!-- RIGHT: Roster panel -->
      <section
        class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-7 backdrop-blur"
      >
        <header class="mb-4 flex items-center justify-between gap-2">
          <h2 class="font-display text-title font-medium">
            {m.examDetail_rosterHeading()}
          </h2>
          <Badge variant="muted" size="sm">
            {detail.registeredCount} / {detail.totalStudents}
          </Badge>
        </header>

        {#if detail.roster && detail.roster.length > 0}
          <ul class="max-h-80 space-y-1 overflow-y-auto pr-1">
            {#each detail.roster as entry (entry.userId)}
              <li
                class="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-border-subtle px-3 py-2.5 last:border-b-0"
              >
                <span
                  class="size-2 rounded-full {entry.status === 'registered'
                    ? 'bg-info'
                    : entry.status === 'active' || entry.status === 'submitted'
                      ? 'bg-success'
                      : 'bg-muted-foreground'}"
                  aria-hidden="true"
                ></span>
                <div class="min-w-0 text-body-sm font-medium">
                  <span class="truncate">{entry.name}</span>
                  {#if entry.handle}
                    <span class="ml-2 font-mono text-caption text-muted-foreground">
                      {entry.handle}
                    </span>
                  {/if}
                </div>
                <span class="text-caption text-muted-foreground">
                  {entry.status === "registered"
                    ? m.examDetail_rosterRegistered()
                    : entry.status === "active"
                      ? m.examDetail_rosterActive()
                      : entry.status === "submitted"
                        ? m.examDetail_rosterSubmitted()
                        : m.examDetail_rosterDisqualified()}
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <div
            class="rounded-xl border border-dashed border-border px-4 py-8 text-center text-body-sm text-muted-foreground"
          >
            {m.examDetail_rosterEmpty()}
          </div>
        {/if}

        <Button
          variant="outline"
          size="sm"
          class="mt-4 w-full"
          disabled={pendingCount === 0}
        >
          {m.examDetail_rosterRemind()}
        </Button>
      </section>
    </div>
    {/if}
  {:else}
    <p
      class="mx-auto mt-2 max-w-[60ch] text-center text-caption text-muted-foreground"
    >
      {m.examDetail_studentNote()}
    </p>

    {#if detail.status === "ended" && detail.problems.length > 0}
      <section
        class="animate-in animate-in-3 mt-10 rounded-2xl border border-border bg-[color:var(--color-panel)] p-7 backdrop-blur"
      >
        <header class="mb-4">
          <h2 class="font-display text-title font-medium">
            {m.examDetail_studentReviewHeading()}
          </h2>
          <p class="mt-1 text-body-sm text-muted-foreground">
            {m.examDetail_studentReviewHint()}
          </p>
        </header>
        <ul class="space-y-2.5">
          {#each detail.problems as problem (problem.id)}
            <li
              class="flex items-center justify-between gap-4 rounded-xl border border-border-subtle px-4 py-3"
            >
              <div class="flex items-center gap-3">
                <span
                  class="min-w-[28px] text-center font-display text-title-sm font-medium text-muted-foreground"
                >
                  {problem.letter}
                </span>
                <div class="min-w-0">
                  <div class="font-semibold">{problem.title}</div>
                  <div class="mt-1 text-caption text-muted-foreground">
                    {difficultyLabel(problem.difficulty)} ·
                    {m.examDetail_problemPoints({ count: problem.points })}
                  </div>
                </div>
              </div>
              <Button href={`/problems/${problem.id}`} variant="outline" size="sm">
                {m.examDetail_problemPreview()}
              </Button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if data.clarification.canView}
      <section
        class="animate-in animate-in-3 mt-10 rounded-2xl border border-border bg-[color:var(--color-panel)] p-7"
      >
        <header class="mb-4">
          <h2 class="font-display text-title font-medium">{m.clarification_tab_title()}</h2>
        </header>
        <ClarificationTab
          contextType="exam"
          contextId={detail.id}
          canAsk={data.clarification.canAsk}
          canAnswer={data.clarification.canAnswer}
          problems={clarificationProblems}
        />
      </section>
    {/if}
  {/if}
</div>

{#if canSetOverride}
  <ScoreOverrideDrawer
    open={showOverrideDrawer}
    onOpenChange={(v) => (showOverrideDrawer = v)}
    contextType="exam"
    contextId={detail.id}
    students={overrideStudents}
    problems={overrideProblems}
  />
{/if}

<style>
  .countdown-card {
    background:
      linear-gradient(
        135deg,
        color-mix(in oklab, var(--color-primary) 8%, transparent),
        color-mix(in oklab, var(--color-primary) 2%, transparent)
      ),
      var(--color-panel-strong, var(--color-panel));
    border-color: color-mix(in oklab, var(--color-primary) 22%, transparent);
    grid-template-columns: 1fr auto;
  }

  .countdown-card .big {
    font-size: 4.5rem;
  }

  .start-btn {
    padding: 1.125rem 2rem;
    border-radius: var(--radius-xl);
    background: var(--color-primary);
    color: white;
    font-family: var(--font-display);
    font-size: var(--text-title-sm);
    font-weight: 500;
    letter-spacing: -0.005em;
    border: none;
    cursor: not-allowed;
    opacity: 0.45;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.24),
      0 2px 4px rgba(79, 52, 35, 0.2);
    transition: box-shadow 200ms ease;
  }

  .start-btn.live {
    opacity: 1;
    cursor: pointer;
    animation: btn-glow 3s ease-in-out infinite;
  }

  @keyframes btn-glow {
    0%,
    100% {
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.24),
        0 4px 12px color-mix(in oklab, var(--color-primary) 30%, transparent);
    }
    50% {
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.24),
        0 4px 24px color-mix(in oklab, var(--color-primary) 55%, transparent);
    }
  }
</style>
