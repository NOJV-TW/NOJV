<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { enhance } from "$app/forms";
  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/utils/css.js";
  import { toasts } from "$lib/stores/toast";
  import { Button } from "$lib/components/primitives/ui/button";
  import ScoreOverrideDrawer from "$lib/components/features/score-override/ScoreOverrideDrawer.svelte";
  import ClarificationTab from "$lib/components/features/clarification/ClarificationTab.svelte";
  import Crumbs from "$lib/components/primitives/visual/Crumbs.svelte";
  import Countdown from "$lib/components/primitives/visual/Countdown.svelte";
  import GlassPanel from "$lib/components/primitives/visual/GlassPanel.svelte";
  import StatRail from "$lib/components/primitives/visual/StatRail.svelte";
  import StatTile from "$lib/components/primitives/visual/StatTile.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import AssessmentHero from "$lib/components/features/coursework/AssessmentHero.svelte";
  import StatusPill from "$lib/components/features/coursework/StatusPill.svelte";
  import AssignmentPlagiarismReport from "$lib/components/features/plagiarism/AssignmentPlagiarismReport.svelte";
  import AuditTimeline from "$lib/components/features/audit/AuditTimeline.svelte";
  import ContestProblemsTab from "$lib/components/features/contest/ContestProblemsTab.svelte";
  import ContestResultsTab from "$lib/components/features/contest/ContestResultsTab.svelte";
  import ContestSettingsTab, {
    type ContestLiveStatus,
  } from "$lib/components/features/contest/ContestSettingsTab.svelte";
  import ContestSubmissionsMatrix from "$lib/components/features/contest/ContestSubmissionsMatrix.svelte";
  import { contestStatusFor, durationMinutes } from "$lib/components/features/contest/format";
  import { contestScoringLabel } from "$lib/utils/contest-scoring";
  import { fmtDate } from "$lib/utils/datetime.js";

  let { data } = $props();
  let contest = $derived(data.contest);
  const isManager = $derived(contest.isManager);

  type SubTabKey =
    | "problems"
    | "submissions"
    | "results"
    | "plagiarism"
    | "settings"
    | "clarifications"
    | "audit";
  let activeSubTab = $state<SubTabKey>("problems");

  const subTabs: { key: SubTabKey; label: string }[] = $derived([
    { key: "problems", label: m.contestDetail_subTabProblems() },
    { key: "submissions", label: m.contestDetail_subTabSubmissions() },
    { key: "results", label: m.contestDetail_subTabResults() },
    { key: "plagiarism", label: m.contestDetail_subTabPlagiarism() },
    { key: "settings", label: m.contestDetail_subTabSettings() },
    ...(data.clarification.canView
      ? [{ key: "clarifications" as const, label: m.contestDetail_subTabClarifications() }]
      : []),
    { key: "audit", label: m.contestDetail_subTabAudit() },
  ]);

  let showOverrideDrawer = $state(false);
  const canSetOverride = $derived(data.canSetOverride);
  const overrideStudents = $derived(data.overrideStudents);
  const overrideProblems = $derived(
    (contest.problems ?? []).map((p) => ({ id: p.id, title: p.title })),
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
  const hasJoined = $derived(data.hasJoined ?? false);
  const needsJoin = $derived(!isManager && !isPast && !hasJoined);
  const settingsLiveStatus: ContestLiveStatus = $derived(
    contest.visibility === "draft" ? "draft" : status === "live" ? "running" : status,
  );
  const scoringLabel = $derived(contestScoringLabel(contest.scoringMode));
  const durationMin = $derived(durationMinutes(contest.startsAt, contest.endsAt));
  const scoreboardModeLabel = $derived(
    contest.scoreboardMode === "hidden"
      ? m.contestDetail_scoreboardModeHidden()
      : contest.scoreboardMode === "frozen"
        ? m.contestDetail_scoreboardModeFrozen()
        : m.contestDetail_scoreboardModeLive(),
  );

  const firstProblem = $derived((contest.problems ?? [])[0] ?? null);
  const primaryHref = $derived(
    isLive && firstProblem
      ? `/contests/${contest.id}/problems/${firstProblem.id}`
      : isPast
        ? `/contests/${contest.id}/upsolve`
        : null,
  );
  const primaryLabel = $derived(
    isLive
      ? m.contestDetail_ctaEnter()
      : isPast
        ? m.contestDetail_actionUpsolve()
        : m.contestDetail_ctaNotStarted(),
  );
</script>

<!-- Defined at the component root (not inside <PageContainer>) so it stays a
     local snippet instead of being treated as a snippet prop of PageContainer. -->
{#snippet actionButtons()}
  {#if canSetOverride}
    {#if isPast}
      <Button variant="outline" type="button" onclick={() => (showOverrideDrawer = true)}>
        {m.grading_openButton()}
      </Button>
    {:else}
      <span class="inline-flex items-center text-caption text-muted-foreground">
        {m.grading_availableAfterClose()}
      </span>
    {/if}
  {/if}
  <Button
    variant="outline"
    onclick={() => {
      if (isUpcoming && !isManager) {
        toasts.warning(m.contestScoreboard_notStartedHint());
      } else {
        void goto(`/contests/${contest.id}/scoreboard`);
      }
    }}
  >
    {m.contestDetail_actionScoreboard()}
  </Button>
  {#if isPast}
    <Button variant="outline" onclick={() => void goto(`/contests/${contest.id}/virtual`)}>
      {m.contestDetail_actionVirtual()}
    </Button>
  {/if}
  {#if needsJoin}
    <form method="POST" action="?/joinContest" use:enhance class="contents">
      <Button type="submit">{m.contestDetail_ctaJoin()}</Button>
    </form>
  {:else if primaryHref}
    <Button onclick={() => void goto(primaryHref)}>
      {#if isLive}
        <span class="size-1.5 rounded-full bg-white"></span>
      {/if}
      {primaryLabel}
    </Button>
  {:else}
    <Button disabled>{primaryLabel}</Button>
  {/if}
{/snippet}

<PageContainer class="space-y-6 fade-up">
  <Crumbs
    items={[{ label: m.navigation_contests(), href: "/contests" }, { label: contest.id }]}
  />

  <AssessmentHero
    kind="contest"
    typeLabel={m.contestDetail_typeLabel()}
    context={m.contestPoster_durationMinutes({ count: durationMin })}
    title={contest.title}
    summary={contest.summary}
  >
    {#snippet badges()}
      <StatusPill {status} type="contest" />
    {/snippet}
  </AssessmentHero>

  <StatRail>
    <StatTile
      label={isLive
        ? m.contestDetail_clockRunning()
        : isPast
          ? m.contestDetail_clockEnded()
          : m.contestDetail_clockUntilStart()}
    >
      {#snippet value()}
        {#if isPast}
          <span class="font-mono">{fmtDate(contest.startsAt)}</span>
        {:else}
          <Countdown iso={isLive ? contest.endsAt : contest.startsAt} />
        {/if}
      {/snippet}
    </StatTile>
    <StatTile label={m.contestDetail_participantsLabel()}>
      {#snippet value()}
        {m.contestDetail_participantsCount({ count: contest.participantCount })}
      {/snippet}
    </StatTile>
    <StatTile label={m.contestDetail_scoringLabel()}>
      {#snippet value()}{scoringLabel}{/snippet}
    </StatTile>
    <StatTile label={m.contestDetail_scoreboardLabel()}>
      {#snippet value()}{scoreboardModeLabel}{/snippet}
    </StatTile>
  </StatRail>

  {#if isManager}
    <div class="flex flex-wrap items-center justify-between gap-3">
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
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        {/each}
      </div>
      <div class="flex flex-wrap items-center gap-3">
        {@render actionButtons()}
      </div>
    </div>

    {#if activeSubTab === "problems"}
      <ContestProblemsTab
        problems={contest.problems}
        problemsHidden={contest.problemsHidden}
        contestId={contest.id}
        scoringMode={contest.scoringMode}
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
    {:else if activeSubTab === "settings"}
      {#if contest.inviteCode}
        <GlassPanel class="p-5">
          <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground mb-2">
            {m.contestDetail_inviteCode()}
          </div>
          <div class="select-all font-mono text-body">{contest.inviteCode}</div>
          <p class="mt-2 text-caption text-muted-foreground">
            {m.contestDetail_inviteCodeHint()}
          </p>
        </GlassPanel>
      {/if}
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
    {:else if activeSubTab === "audit"}
      <GlassPanel class="p-5">
        <AuditTimeline events={data.auditEvents} actorNames={data.auditActorNames} />
      </GlassPanel>
    {/if}
  {:else}
    <div class="flex flex-wrap items-center justify-end gap-3">
      {@render actionButtons()}
    </div>
    <div class="grid gap-6 lg:grid-cols-[1fr_320px]">
      <ContestProblemsTab
        problems={contest.problems}
        problemsHidden={contest.problemsHidden}
        contestId={contest.id}
        scoringMode={contest.scoringMode}
        {isLive}
        {isPast}
        {isManager}
      />

      <div class="space-y-4">
        {#if (isLive || isPast) && data.topEntries.length > 0}
          <GlassPanel class="p-5">
            <div class="flex items-center justify-between mb-3">
              <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
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
                      ? "color: var(--rank-gold);"
                      : r.rank === 2
                        ? "color: var(--rank-silver);"
                        : r.rank === 3
                          ? "color: var(--rank-bronze);"
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
      </div>
    </div>

    {#if data.clarification.canView}
      <GlassPanel class="p-6">
        <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground mb-3">
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
</PageContainer>

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
