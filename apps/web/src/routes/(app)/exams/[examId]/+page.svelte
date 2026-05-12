<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/utils.js";
  import { ChevronRight, Pencil } from "@lucide/svelte";
  import Crumbs from "$lib/components/coursework/Crumbs.svelte";
  import CornerMark from "$lib/components/coursework/CornerMark.svelte";
  import DotGrid from "$lib/components/coursework/DotGrid.svelte";
  import TypeIcon from "$lib/components/coursework/TypeIcon.svelte";
  import StatusPill from "$lib/components/coursework/StatusPill.svelte";
  import Countdown from "$lib/components/coursework/Countdown.svelte";
  import GlassPanel from "$lib/components/coursework/GlassPanel.svelte";
  import DifficultyTick from "$lib/components/coursework/DifficultyTick.svelte";
  import ExamSubmissionsMatrix from "$lib/components/course/exam/ExamSubmissionsMatrix.svelte";
  import ExamSettingsTab from "$lib/components/course/exam/ExamSettingsTab.svelte";
  import ExamProblemsTab from "$lib/components/course/exam/ExamProblemsTab.svelte";
  import ExamStartModal from "$lib/components/course/exam/ExamStartModal.svelte";
  import ScoreOverrideDrawer from "$lib/components/score-override/ScoreOverrideDrawer.svelte";
  import ClarificationTab from "$lib/components/clarification/ClarificationTab.svelte";
  import { fmtDate } from "$lib/utils/datetime.js";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const detail = $derived(data.detail);
  const isManager = $derived(data.isManager);

  // Re-tick every second so countdown / live-status flips don't need a reload.
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

  type LiveStatus = "draft" | "upcoming" | "running" | "ended" | "archived";
  const liveStatus: LiveStatus = $derived.by(() => {
    if (detail.status === "draft") return "draft";
    if (detail.status === "archived") return "archived";
    if (nowMs < startsAtMs) return "upcoming";
    if (nowMs >= endsAtMs) return "ended";
    return "running";
  });

  const past = $derived(liveStatus === "ended" || liveStatus === "archived");

  function pillStatus(s: LiveStatus): string {
    if (s === "running") return "in_progress";
    if (s === "upcoming") return "scheduled";
    if (s === "draft") return "scheduled";
    return "ended";
  }

  // Code stub — domain doesn't expose a short code, so derive one
  // from the exam id (last 6 chars) so the UI still has the
  // "EX-xxxxxx" eyebrow the design specifies.
  const examCode = $derived(`EX-${detail.id.slice(-6).toUpperCase()}`);

  // Difficulty domain enum → DifficultyTick prop (PascalCase).
  function difficultyLevel(d: "easy" | "medium" | "hard"): "Easy" | "Medium" | "Hard" {
    if (d === "easy") return "Easy";
    if (d === "hard") return "Hard";
    return "Medium";
  }

  // Allowed languages — only the manager payload knows them; for
  // students we fall back to a sensible default list so the pre-exam
  // rules card has something to render.
  const allowedLanguages = $derived(
    detail.manager?.allowedLanguages ?? ["cpp17", "python311", "java17"]
  );

  // Static rules — domain doesn't expose author-authored rules. Use
  // a derived list that reflects the actual proctoring config so the
  // student sees what's actually enforced, plus a few generic exam
  // hygiene rules.
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
          : m.examDetail_ruleIpBindingNotify()
      );
    }
    if (detail.ipWhitelistEnabled) {
      list.push(m.examDetail_ruleIpWhitelist({ count: detail.ipWhitelistCount }));
    }
    list.push(m.examDetail_ruleAskClarifications());
    return list;
  });

  // Modal state for the pre-exam "start" CTA.
  let showStartModal = $state(false);

  // Manager sub-tabs (problems / submissions / settings / clarifications).
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

  // ReviewRow tint by viewer outcome (for past-exam problem list).
  function rowTint(state: "ac" | "partial" | "zero" | "empty" | null): string {
    if (state === "ac") return "bg-success/[0.06]";
    if (state === "partial")
      return "bg-[color:color-mix(in_oklab,var(--chart-4)_8%,transparent)]";
    return "";
  }
</script>

<div class="space-y-6 pb-20 fade-up">
  <Crumbs
    items={[{ label: "exam", href: "/exams" }, { label: examCode }]}
  />

  <!-- Hero — bordered "official" block with corner crosshairs + dot grid -->
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
            <span>Examination</span>
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
                <span class="text-micro uppercase tracking-wider text-muted-foreground">{m.examDetail_scoreLabel()}</span>
                <span class="font-semibold" style="color: var(--primary);">
                  {detail.viewerScore}
                </span>
                <span class="text-muted-foreground">/ {detail.totalPoints}</span>
              </div>
            {/if}
          </div>
          <h1
            class="mt-3 text-headline font-semibold tracking-tight lg:text-display"
          >
            {detail.title}
          </h1>
          {#if detail.summary}
            <p class="mt-4 max-w-2xl text-body text-muted-foreground">{detail.summary}</p>
          {/if}
        </div>

        <!-- Big-clock side -->
        <div
          class="min-w-[260px] rounded-lg border border-dashed p-3"
          style="border-color: var(--border-strong);"
        >
          <div
            class="font-mono text-micro uppercase tracking-[0.18em] text-muted-foreground"
          >
            {past ? m.examDetail_clockHeld() : liveStatus === "running" ? m.examDetail_clockRunning() : m.examDetail_clockUntilStart()}
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
          <div
            class="mt-3 space-y-1 border-t border-border-subtle pt-3 font-mono text-caption"
          >
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

  <!-- ─── STUDENT / NON-MANAGER VIEW ─── -->
  {#if !isManager}
    {#if past}
      <!-- Compact rules note + past problem list (assignment-style). -->
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
            languages: allowedLanguages.join(" / ")
          })}
        </p>
      </GlassPanel>

      <GlassPanel class="overflow-hidden">
        <div
          class="flex items-center justify-between border-b border-border-subtle px-6 py-4"
        >
          <h2 class="text-title font-semibold">{m.examDetail_studentProblemsHeading()}</h2>
          <span
            class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-micro uppercase tracking-wider"
            style="background: var(--muted); color: var(--muted-foreground);"
          >
            <span
              class="size-1.5 rounded-full"
              style="background: var(--muted-foreground);"
            ></span>
            {m.examDetail_endedPill()}
          </span>
        </div>
        <div class="divide-y" style="border-color: var(--border-subtle);">
          {#each detail.problems as p (p.id)}
            {@const verdict = p.viewerState ?? "empty"}
            <a
              href={`/problems/${p.id}`}
              class={cn(
                "grid grid-cols-[60px_1fr_auto_auto_auto] items-center gap-4 px-6 py-3.5 text-inherit no-underline transition-colors hover:bg-muted/40",
                rowTint(p.viewerState)
              )}
            >
              <div class="font-mono text-body font-semibold text-muted-foreground">
                {p.letter}
              </div>
              <div>
                <div class="font-medium">{p.title}</div>
                <div class="mt-1 flex items-center gap-3">
                  <DifficultyTick level={difficultyLevel(p.difficulty)} />
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
                <ChevronRight class="size-3.5" />
              </span>
            </a>
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
      <!-- Pre-exam: rules + action panel. -->
      <div class="grid gap-6 lg:grid-cols-[1fr_360px]">
        <!-- Rules -->
        <GlassPanel class="p-7">
          <div class="flex items-start justify-between gap-3">
            <h2 class="flex items-center gap-2 text-title font-semibold">
              <span class="size-1.5 rounded-full bg-primary"></span> {m.examDetail_studentRulesHeading()}
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

        <!-- Action panel -->
        <GlassPanel class="flex flex-col gap-4 p-6">
          <div>
            <div
              class="font-mono text-micro uppercase tracking-wider text-muted-foreground"
            >
              {m.examDetail_studentPrepEyebrow()}
            </div>
            <h3 class="mt-1 text-title font-semibold">{m.examDetail_studentPrepHeading()}</h3>
          </div>
          <ul class="space-y-2 text-body-sm">
            <li class="flex items-start gap-2">
              <span
                class="mt-0.5 inline-flex size-4 items-center justify-center rounded-full"
                style="background: color-mix(in oklab, var(--success) 18%, transparent); color: oklch(0.45 0.13 160);"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              </span>
              <span>{m.examDetail_studentPrepRule1()}</span>
            </li>
            <li class="flex items-start gap-2">
              <span
                class="mt-0.5 inline-flex size-4 items-center justify-center rounded-full"
                style="background: color-mix(in oklab, var(--success) 18%, transparent); color: oklch(0.45 0.13 160);"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              </span>
              <span>{m.examDetail_studentPrepRule2()}</span>
            </li>
            <li class="flex items-start gap-2">
              <span
                class="mt-0.5 inline-flex size-4 items-center justify-center rounded-full"
                style="background: color-mix(in oklab, var(--success) 18%, transparent); color: oklch(0.45 0.13 160);"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              </span>
              <span>{m.examDetail_studentPrepRule3()}</span>
            </li>
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
    <!-- ─── MANAGER VIEW ─── -->
    <!-- Compact rules note with edit pencil. -->
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
          onclick={() => (activeTab = "settings")}
          class="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 text-caption font-medium transition-colors hover:border-border"
        >
          <Pencil class="size-3" /> {m.examDetail_managerEditButton()}
        </button>
      </div>
      <p class="text-body-sm text-muted-foreground">
        {m.examDetail_rulesNoteSummary({
          problems: detail.problems.length,
          minutes: durationMinutes,
          points: detail.totalPoints,
          languages: allowedLanguages.join(" / ")
        })}
        {#if detail.pageLockEnabled || detail.ipBindingEnabled || detail.ipWhitelistEnabled}
          {m.examDetail_rulesNoteEnabledFeatures({
            features: [
              detail.pageLockEnabled ? m.examDetail_featurePageLock() : null,
              detail.ipBindingEnabled ? m.examDetail_featureIpBinding() : null,
              detail.ipWhitelistEnabled ? m.examDetail_featureIpWhitelist() : null
            ]
              .filter(Boolean)
              .join(m.examDetail_featuresSeparator())
          })}
        {/if}
      </p>
    </GlassPanel>

    <!-- Quick links -->
    <div class="flex flex-wrap gap-2">
      <a
        href={`/exams/${detail.id}/results`}
        class="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-[color:var(--color-panel)]/60 px-3 py-2 text-caption font-medium transition-colors hover:border-border"
      >
        {m.examDetail_managerClassResultsLink()}
      </a>
      <button
        type="button"
        onclick={() => (activeTab = "submissions")}
        class="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-[color:var(--color-panel)]/60 px-3 py-2 text-caption font-medium transition-colors hover:border-border"
      >
        {m.examDetail_managerSubmissionMatrixLink()}
      </button>
      {#if canSetOverride}
        <button
          type="button"
          onclick={() => (showOverrideDrawer = true)}
          class="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-[color:var(--color-panel)]/60 px-3 py-2 text-caption font-medium transition-colors hover:border-border"
        >
          {m.override_staff_buttonLabel()}
        </button>
      {/if}
    </div>

    <!-- Manager tabs (problems / submissions / settings / clarifications) -->
    <div
      role="tablist"
      aria-label={m.examDetail_subTabsLabel()}
      class="inline-flex items-center gap-1 rounded-lg border border-border bg-[color:var(--color-panel)]/60 p-1"
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "problems"}
        onclick={() => (activeTab = "problems")}
        class="rounded-md px-3.5 py-1.5 text-body-sm font-medium transition-colors {activeTab ===
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
        class="rounded-md px-3.5 py-1.5 text-body-sm font-medium transition-colors {activeTab ===
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
        class="rounded-md px-3.5 py-1.5 text-body-sm font-medium transition-colors {activeTab ===
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
          class="rounded-md px-3.5 py-1.5 text-body-sm font-medium transition-colors {activeTab ===
          'clarifications'
            ? 'bg-[color:var(--color-primary)]/14 text-primary'
            : 'text-muted-foreground hover:text-foreground'}"
        >
          {m.clarification_tab_title()}
        </button>
      {/if}
    </div>

    {#if activeTab === "submissions" && data.matrix}
      <GlassPanel class="p-5">
        <ExamSubmissionsMatrix matrix={data.matrix} examId={detail.id} />
      </GlassPanel>
    {:else if activeTab === "settings" && data.settingsForm}
      <ExamSettingsTab form={data.settingsForm} {detail} {liveStatus} />
    {:else if activeTab === "clarifications"}
      <GlassPanel class="p-5">
        <ClarificationTab
          contextType="exam"
          contextId={detail.id}
          canAsk={data.clarification.canAsk}
          canAnswer={data.clarification.canAnswer}
          problems={clarificationProblems}
        />
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
</div>

<!-- Pre-exam start modal -->
{#if !isManager && !past}
  <ExamStartModal
    open={showStartModal}
    onOpenChange={(v) => (showStartModal = v)}
    examTitle={detail.title}
    problemCount={detail.problems.length}
    {durationMinutes}
  />
{/if}

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
