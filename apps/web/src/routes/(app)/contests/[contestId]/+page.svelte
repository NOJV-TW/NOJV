<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/utils/css.js";
  import { Button } from "$lib/components/ui/button";
  import ScoreOverrideDrawer from "$lib/components/score-override/ScoreOverrideDrawer.svelte";
  import ClarificationTab from "$lib/components/clarification/ClarificationTab.svelte";
  import Crumbs from "$lib/components/coursework/Crumbs.svelte";
  import Countdown from "$lib/components/coursework/Countdown.svelte";
  import GlassPanel from "$lib/components/coursework/GlassPanel.svelte";
  import Marquee from "$lib/components/coursework/Marquee.svelte";
  import StatusPill from "$lib/components/coursework/StatusPill.svelte";
  import TabStrip from "$lib/components/coursework/TabStrip.svelte";
  import TypeIcon from "$lib/components/coursework/TypeIcon.svelte";
  import AssignmentPlagiarismReport from "$lib/components/plagiarism/AssignmentPlagiarismReport.svelte";
  import ContestProblemsTab from "$lib/components/contest/ContestProblemsTab.svelte";
  import ContestResultsTab from "$lib/components/contest/ContestResultsTab.svelte";
  import ContestSettingsTab, {
    type ContestLiveStatus
  } from "$lib/components/contest/ContestSettingsTab.svelte";
  import ContestSubmissionsMatrix from "$lib/components/contest/ContestSubmissionsMatrix.svelte";
  import { contestStatusFor, durationMinutes } from "$lib/components/contest/format";
  import { fmtDate } from "$lib/utils/datetime.js";

  let { data } = $props();
  let contest = $derived(data.contest);
  const isManager = $derived(contest.isManager);

  // Manager sub-tabs. Defaults to "problems" on mount so the page first
  // renders the same problem list students see.
  type SubTabKey =
    | "problems"
    | "submissions"
    | "results"
    | "plagiarism"
    | "settings"
    | "clarifications";
  let activeSubTab = $state<SubTabKey>("problems");

  const subTabs: { key: SubTabKey; label: string }[] = $derived([
    { key: "problems", label: m.contestDetail_subTabProblems() },
    { key: "submissions", label: m.contestDetail_subTabSubmissions() },
    { key: "results", label: m.contestDetail_subTabResults() },
    { key: "plagiarism", label: m.contestDetail_subTabPlagiarism() },
    { key: "settings", label: m.contestDetail_subTabSettings() },
    ...(data.clarification.canView
      ? [{ key: "clarifications" as const, label: m.contestDetail_subTabClarifications() }]
      : [])
  ]);

  let showOverrideDrawer = $state(false);
  const canSetOverride = $derived(data.canSetOverride);
  const overrideStudents = $derived(data.overrideStudents);
  const overrideProblems = $derived(
    (contest.problems ?? []).map((p) => ({ id: p.id, title: p.title }))
  );

  let now = $state(new Date());
  onMount(() => {
    const id = setInterval(() => {
      now = new Date();
    }, 1000);
    return () => clearInterval(id);
  });

  const status = $derived(contestStatusFor(contest.startsAt, contest.endsAt, now));
  const isLive = $derived(status === "live");
  const isPast = $derived(status === "ended");
  const isUpcoming = $derived(status === "upcoming");
  const settingsLiveStatus: ContestLiveStatus = $derived(
    contest.visibility === "draft" ? "draft" : status === "live" ? "running" : status
  );
  const scoringLabel = $derived(
    contest.scoringMode === "problem_count"
      ? m.contestDetail_scoringProblemCount()
      : m.contestDetail_scoringPointSum()
  );
  const durationMin = $derived(durationMinutes(contest.startsAt, contest.endsAt));

  // First visible problem — used as the "enter contest" target during live.
  const firstProblem = $derived((contest.problems ?? [])[0] ?? null);
  const primaryHref = $derived(
    isLive && firstProblem
      ? `/contests/${contest.id}/problems/${firstProblem.id}`
      : isPast
        ? `/contests/${contest.id}/scoreboard`
        : null
  );
  const primaryLabel = $derived(
    isLive
      ? m.contestDetail_ctaEnter()
      : isPast
        ? m.contestDetail_ctaViewSolutions()
        : m.contestDetail_ctaNotStarted()
  );

</script>

<div class="space-y-6 fade-up px-6 py-8 lg:px-10 pb-20">
  <Crumbs items={[{ label: "contest", href: "/contests" }, { label: contest.id }]} />

  <!-- Hero -->
  <div
    class="relative overflow-hidden rounded-xl shadow-rest"
    style="border: 1px solid var(--border); background: {isLive
      ? 'linear-gradient(135deg, color-mix(in oklab, var(--destructive) 12%, var(--panel-strong)) 0%, var(--panel-strong) 60%)'
      : 'linear-gradient(135deg, color-mix(in oklab, var(--primary) 14%, var(--panel-strong)) 0%, var(--panel-strong) 60%)'};"
  >
    <Marquee
      text="{contest.id} · {contest.title.toUpperCase()} · {scoringLabel} · {contest.participantCount} PARTICIPANTS"
    />

    <div class="relative px-7 py-9 lg:p-10">
      <div class="flex flex-wrap items-start gap-6 justify-between">
        <div class="min-w-0">
          <div
            class="flex items-center gap-2 text-micro font-mono uppercase tracking-[0.2em] text-muted-foreground"
          >
            <TypeIcon kind="contest" size={14} />
            <span>Contest · {scoringLabel}</span>
          </div>
          <div class="mt-3">
            <StatusPill {status} type="contest" />
          </div>
          <h1
            class="mt-3 font-semibold tracking-tight"
            style="font-size: clamp(2rem, 4.2vw, 3.5rem); line-height: 1.05;"
          >
            {contest.title}
          </h1>
          {#if contest.summary}
            <p class="mt-4 max-w-2xl text-body text-muted-foreground">
              {contest.summary}
            </p>
          {/if}
        </div>

        <!-- Stats sidebar / clock -->
        <div
          class="rounded-lg border p-3 min-w-[280px]"
          style="border-color: var(--border); background: var(--panel);"
        >
          <div
            class="flex items-center gap-2 text-micro font-mono uppercase tracking-[0.18em] text-muted-foreground"
          >
            {#if isLive}
              <span
                class="size-1.5 rounded-full live-dot"
                style="background: oklch(0.55 0.2 27);"
              ></span>
            {/if}
            <span>{isLive ? m.contestDetail_clockRunning() : isPast ? m.contestDetail_clockEnded() : m.contestDetail_clockUntilStart()}</span>
          </div>
          <div class="mt-2">
            {#if isPast}
              <div class="font-mono text-title">{fmtDate(contest.startsAt)}</div>
            {:else}
              <Countdown iso={isLive ? contest.endsAt : contest.startsAt} />
            {/if}
          </div>
          <div
            class="mt-3 pt-3 border-t space-y-1 text-caption font-mono"
            style="border-color: var(--border-subtle);"
          >
            <div class="flex justify-between">
              <span class="text-muted-foreground">{m.contestDetail_metaStartsLabel()}</span>
              <span>{fmtDate(contest.startsAt)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">{m.contestDetail_metaEndsLabel()}</span>
              <span>{fmtDate(contest.endsAt)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">{m.contestDetail_metaDurationLabel()}</span>
              <span>{m.contestDetail_metaDurationMinutes({ count: durationMin })}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">{m.contestDetail_metaParticipantsLabel()}</span>
              <span>{m.contestDetail_metaParticipantsCount({ count: contest.participantCount })}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Action bar -->
  <div class="flex flex-wrap items-center gap-3">
    <TabStrip tabs={[{ value: "overview", label: m.contestDetail_tabOverview() }]} activeTabValue="overview" onChange={() => {}} />

    <div class="ml-auto flex flex-wrap gap-3">
      {#if canSetOverride}
        <Button variant="outline" type="button" onclick={() => (showOverrideDrawer = true)}>
          {m.contestDetail_actionScoreOverride()}
        </Button>
      {/if}
      <Button variant="outline" onclick={() => void goto(`/contests/${contest.id}/scoreboard`)}>
        {m.contestDetail_actionScoreboard()}
      </Button>
      {#if primaryHref}
        <Button onclick={() => void goto(primaryHref)}>
          {#if isLive}
            <span class="size-1.5 rounded-full bg-white"></span>
          {/if}
          {primaryLabel}
        </Button>
      {:else}
        <Button disabled>{primaryLabel}</Button>
      {/if}
    </div>
  </div>

  {#if isManager}
    <!-- ══════ MANAGER VIEW: tabbed sections ══════ -->
    <div
      role="tablist"
      aria-label={m.contestDetail_subTabsLabel()}
      class="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-[color:var(--color-panel)]/60 p-1"
    >
      {#each subTabs as tab (tab.key)}
        {@const isActive = activeSubTab === tab.key}
        <button
          type="button"
          role="tab"
          aria-selected={isActive}
          onclick={() => (activeSubTab = tab.key)}
          class={cn(
            "rounded-md px-3.5 py-1.5 text-body-sm font-medium transition-colors",
            isActive
              ? "bg-[color:var(--color-primary)]/14 text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
        </button>
      {/each}
    </div>

    {#if activeSubTab === "problems"}
      <ContestProblemsTab
        problems={contest.problems}
        problemsHidden={contest.problemsHidden}
        contestId={contest.id}
        {isLive}
        {isPast}
        {isManager}
      />
    {:else if activeSubTab === "submissions"}
      {#if data.matrix}
        <ContestSubmissionsMatrix matrix={data.matrix} contestId={contest.id} />
      {:else}
        <GlassPanel class="p-8 text-center text-body text-muted-foreground">
          {m.contestDetail_submissionsTabPlaceholder()}
        </GlassPanel>
      {/if}
    {:else if activeSubTab === "results"}
      {#if data.results}
        <ContestResultsTab data={data.results} />
      {:else}
        <GlassPanel class="p-8 text-center text-body text-muted-foreground">
          {m.contestDetail_resultsTabUnavailable()}
        </GlassPanel>
      {/if}
    {:else if activeSubTab === "plagiarism"}
      <GlassPanel class="p-5">
        <AssignmentPlagiarismReport
          report={data.plagiarism}
          flags={data.plagiarismFlags ?? []}
          diffContext={{ type: "contest", id: contest.id }}
          problems={(contest.problems ?? []).map((p, i) => ({
            problemId: p.id,
            letter: String.fromCharCode(65 + i),
            title: p.title
          }))}
          students={data.matrix
            ? data.matrix.rows.map((r) => ({
                userId: r.userId,
                displayName: r.displayName,
                handle: r.handle
              }))
            : []}
        />
      </GlassPanel>
    {:else if activeSubTab === "settings"}
      {#if data.settingsForm}
        <ContestSettingsTab form={data.settingsForm} liveStatus={settingsLiveStatus} />
      {:else}
        <GlassPanel class="p-8 text-center text-body text-muted-foreground">
          {m.contestDetail_settingsTabPlaceholder()}
        </GlassPanel>
      {/if}
    {:else if activeSubTab === "clarifications" && data.clarification.canView}
      <GlassPanel class="p-6">
        <ClarificationTab
          contextType="contest"
          contextId={contest.id}
          canAsk={data.clarification.canAsk}
          canAnswer={data.clarification.canAnswer}
          problems={(contest.problems ?? []).map((p) => ({ id: p.id, title: p.title }))}
        />
      </GlassPanel>
    {/if}
  {:else}
  <div class="grid gap-6 lg:grid-cols-[1fr_320px]">
    <!-- Problem list -->
    <ContestProblemsTab
      problems={contest.problems}
      problemsHidden={contest.problemsHidden}
      contestId={contest.id}
      {isLive}
      {isPast}
      {isManager}
    />

    <!-- Sidebar -->
    <div class="space-y-4">
      {#if (isLive || isPast) && data.topEntries.length > 0}
        <GlassPanel class="p-5">
          <div class="flex items-center justify-between mb-3">
            <div
              class="font-mono text-micro uppercase tracking-wider text-muted-foreground"
            >
              {m.contestDetail_topRankingsHeading()}
            </div>
            <a
              href="/contests/{contest.id}/scoreboard"
              class="text-caption font-medium"
              style="color: var(--primary);"
            >
              {m.contestDetail_topRankingsFullLink()}
            </a>
          </div>
          <ul class="space-y-2">
            {#each data.topEntries as r (r.username)}
              <li class="flex items-center gap-3 text-body-sm">
                <span
                  class="font-mono text-caption font-bold w-6 {r.rank <= 3
                    ? ''
                    : 'text-muted-foreground'}"
                  style={r.rank === 1
                    ? "color: #d4a054;"
                    : r.rank === 2
                      ? "color: #a0a0a0;"
                      : r.rank === 3
                        ? "color: #cd7f32;"
                        : ""}
                >
                  {r.rank}
                </span>
                <span
                  class="flex-1 truncate {r.isMe ? 'font-semibold' : ''}"
                  style={r.isMe ? "color: var(--primary);" : ""}
                >
                  {r.username}{r.isMe ? m.contestDetail_youSuffix() : ""}
                </span>
                <span class="font-mono tabular-nums">{r.totalScore}</span>
              </li>
            {/each}
          </ul>
        </GlassPanel>
      {/if}

      <GlassPanel class="p-5">
        <div
          class="font-mono text-micro uppercase tracking-wider text-muted-foreground mb-3"
        >
          {m.contestDetail_formatInfoHeading()}
        </div>
        <dl class="space-y-2.5 text-body-sm">
          <div class="flex justify-between">
            <dt class="text-muted-foreground">{m.contestDetail_scoringLabel()}</dt>
            <dd class="font-mono">{scoringLabel}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted-foreground">{m.contestDetail_scoreboardLabel()}</dt>
            <dd class="font-mono">{contest.scoreboardMode}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted-foreground">{m.contestDetail_participantsLabel()}</dt>
            <dd class="font-mono">{m.contestDetail_participantsCount({ count: contest.participantCount })}</dd>
          </div>
          {#if contest.submitCooldownSec > 0}
            <div class="flex justify-between">
              <dt class="text-muted-foreground">{m.contestDetail_submitCooldownLabel()}</dt>
              <dd class="font-mono">{contest.submitCooldownSec}s</dd>
            </div>
          {/if}
          {#if contest.allowedLanguages.length > 0}
            <div class="flex justify-between gap-3">
              <dt class="text-muted-foreground">{m.contestDetail_allowedLanguagesLabel()}</dt>
              <dd class="font-mono text-right truncate">
                {contest.allowedLanguages.join(", ")}
              </dd>
            </div>
          {/if}
        </dl>
      </GlassPanel>
    </div>
  </div>

  {#if data.clarification.canView}
    <GlassPanel class="p-6">
      <div
        class="font-mono text-micro uppercase tracking-wider text-muted-foreground mb-3"
      >
        {m.contestDetail_subTabClarifications()}
      </div>
      <ClarificationTab
        contextType="contest"
        contextId={contest.id}
        canAsk={data.clarification.canAsk}
        canAnswer={data.clarification.canAnswer}
        problems={(contest.problems ?? []).map((p) => ({ id: p.id, title: p.title }))}
      />
    </GlassPanel>
  {/if}
  {/if}
</div>

{#if canSetOverride}
  <ScoreOverrideDrawer
    open={showOverrideDrawer}
    onOpenChange={(v) => (showOverrideDrawer = v)}
    contextType="contest"
    contextId={contest.id}
    students={overrideStudents}
    problems={overrideProblems}
  />
{/if}
