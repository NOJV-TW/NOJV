<script lang="ts">
  import { enhance } from "$app/forms";
  import { page } from "$app/state";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import Lock from "@lucide/svelte/icons/lock";
  import Link2 from "@lucide/svelte/icons/link-2";
  import Shield from "@lucide/svelte/icons/shield";
  import Users from "@lucide/svelte/icons/users";
  import { m } from "$lib/paraglide/messages.js";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import TeacherBadge from "$lib/components/common/TeacherBadge.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const detail = $derived(data.detail);
  const isManager = $derived(data.isManager);
  const courseId = $derived(data.courseId);

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
  type LiveStatus = "draft" | "upcoming" | "running" | "ended";
  const liveStatus: LiveStatus = $derived.by(() => {
    if (detail.status === "draft") return "draft";
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
    return m.examDetail_statusUpcoming();
  }

  function statusVariant(s: LiveStatus): "info" | "default" | "muted" {
    if (s === "running") return "default";
    if (s === "ended" || s === "draft") return "muted";
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

  type SubTab = "problems" | "submissions" | "settings";
  const activeTab = $derived<SubTab>("problems");

  // Sticky helper for the breadcrumb URL.
  const examsListHref = $derived(`/courses/${courseId}/exams`);

  // Pending-vs-registered split for the roster footer note.
  const pendingCount = $derived(
    detail.roster ? detail.roster.filter((r) => r.status === "registered").length : 0
  );
</script>

<div class="space-y-6 pb-20">
  <!-- HERO -->
  <section class="animate-in animate-in-1 border-b border-border pb-9 pt-2">
    <a
      href={examsListHref}
      class="inline-flex items-center gap-1 text-body-sm text-muted-foreground transition-colors duration-fast ease-out-soft hover:text-foreground"
    >
      <ChevronLeft class="size-4" aria-hidden="true" />
      <span>{m.examDetail_breadcrumb()}</span>
    </a>

    <div class="mt-4 flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="text-caption font-semibold uppercase tracking-[0.12em] text-primary">
          {m.examDetail_eyebrow()}
        </div>
        <h1
          class="mt-2 font-display text-display font-normal leading-none tracking-[-0.025em]"
        >
          {detail.title}
        </h1>
        <div
          class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-body-sm text-muted-foreground"
        >
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
            {m.examDetail_problemCount({ count: detail.problems.length })} ·
            {scoringLabel(detail.scoringMode)}
          </span>
        </div>
      </div>
      {#if isManager}
        <TeacherBadge role="teacher" />
      {/if}
    </div>

    <!-- COUNTDOWN CARD -->
    <div
      class="countdown-card animate-in animate-in-2 mt-8 grid items-center gap-8 rounded-3xl border px-10 py-10 shadow-rest"
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

    <!-- PLACEHOLDER BANNER for the 4.2 endpoint -->
    {#if form?.error}
      <div
        role="alert"
        class="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-body-sm text-warning"
      >
        {form.error}
      </div>
    {/if}

    <!-- PROCTOR INFO ROW -->
    <div
      class="mt-6 grid gap-5 rounded-2xl border border-border bg-[color:var(--color-panel)]/60 px-6 py-5 sm:grid-cols-2 lg:grid-cols-4"
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
  </section>

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
          aria-selected={false}
          disabled
          class="rounded-lg px-3.5 py-1.5 text-body-sm font-medium text-muted-foreground/60"
          title={m.examDetail_subTabComingSoon()}
        >
          {m.examDetail_subTabSubmissions()} <span class="text-caption">—</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={false}
          disabled
          class="rounded-lg px-3.5 py-1.5 text-body-sm font-medium text-muted-foreground/60"
          title={m.examDetail_subTabComingSoon()}
        >
          {m.examDetail_subTabSettings()}
        </button>
      </div>
    </div>

    <div
      class="animate-in animate-in-4 grid gap-8 lg:grid-cols-[1.4fr_1fr]"
    >
      <!-- LEFT: Problems panel -->
      <section
        class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-7 backdrop-blur"
      >
        <header class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-display text-title font-medium">
            {m.examDetail_problemsHeading()}
          </h2>
          <span class="text-caption text-muted-foreground">
            {m.examDetail_problemsHint()}
          </span>
        </header>

        {#if detail.problems.length === 0}
          <div
            class="rounded-xl border border-dashed border-border px-4 py-8 text-center text-body-sm text-muted-foreground"
          >
            {m.examDetail_problemsEmpty()}
          </div>
        {:else}
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
                <Button
                  href={`/problems/${problem.id}`}
                  variant="outline"
                  size="sm"
                >
                  {m.examDetail_problemPreview()}
                </Button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

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
  {:else}
    <p
      class="mx-auto mt-2 max-w-[60ch] text-center text-caption text-muted-foreground"
    >
      {m.examDetail_studentNote()}
    </p>
  {/if}
</div>

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
