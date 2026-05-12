<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
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
  import DifficultyTick from "$lib/components/coursework/DifficultyTick.svelte";
  import { contestStatusFor, durationMinutes } from "$lib/components/contest/format";
  import { fmtDate } from "$lib/utils/datetime.js";

  let { data } = $props();
  let contest = $derived(data.contest);

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

  function difficultyOf(p: { points: number }): "Easy" | "Medium" | "Hard" {
    if (p.points >= 800) return "Hard";
    if (p.points >= 400) return "Medium";
    return "Easy";
  }
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
    <TabStrip tabs={[{ value: "overview", label: m.contestDetail_tabOverview() }]} active="overview" onChange={() => {}} />

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

  <div class="grid gap-6 lg:grid-cols-[1fr_320px]">
    <!-- Problem list -->
    <GlassPanel class="overflow-hidden">
      <div
        class="flex items-center justify-between px-6 py-4 border-b"
        style="border-color: var(--border-subtle);"
      >
        <h2 class="text-title font-semibold">{m.contestDetail_problemsHeading()}</h2>
        <div class="text-caption text-muted-foreground">
          {#if contest.problemsHidden || contest.problems === null}
            {m.contestDetail_problemsLockedHint()}
          {:else}
            {m.contestDetail_problemsMeta({
              count: contest.problems.length,
              note: isPast ? m.contestDetail_problemsSortByDifficulty() : m.contestDetail_problemsUnlockOnStart()
            })}
          {/if}
        </div>
      </div>

      <div class="divide-y" style="border-color: var(--border-subtle);">
        {#if contest.problemsHidden || contest.problems === null}
          <!-- Locked placeholders -->
          {#each [0, 1, 2, 3, 4] as i (i)}
            <div
              class="grid grid-cols-[60px_1fr_auto] items-center gap-4 px-6 py-3.5"
            >
              <div class="font-mono text-title font-semibold text-muted-foreground">
                {String.fromCharCode(65 + i)}
              </div>
              <div>
                <div class="font-medium text-muted-foreground">———————</div>
                <div class="mt-1 flex items-center gap-3">
                  <DifficultyTick level="Medium" />
                </div>
              </div>
              <span
                class="text-caption font-medium px-3 py-1.5 rounded-md border text-muted-foreground"
                style="border-color: var(--border-subtle); opacity: 0.5;"
              >
                🔒
              </span>
            </div>
          {/each}
        {:else}
          {#each contest.problems as p (p.id)}
            {@const enterHref =
              isLive || contest.isManager
                ? `/contests/${contest.id}/problems/${p.id}`
                : isPast
                  ? `/problems/${p.id}`
                  : null}
            <a
              href={enterHref ?? "#"}
              class="grid grid-cols-[60px_1fr_auto] sm:grid-cols-[60px_1fr_minmax(120px,160px)_auto] items-center gap-4 px-6 py-3.5 transition-colors hover:bg-muted/40 {enterHref
                ? ''
                : 'pointer-events-none opacity-60'}"
              tabindex={enterHref ? 0 : -1}
              aria-disabled={enterHref ? undefined : true}
            >
              <div
                class="font-mono text-title font-semibold"
                style="color: var(--primary);"
              >
                {String.fromCharCode(64 + p.ordinal)}
              </div>
              <div class="min-w-0">
                <div class="font-medium truncate">{p.title}</div>
                <div class="mt-1 flex items-center gap-3">
                  <DifficultyTick level={difficultyOf(p)} />
                  <span
                    class="text-micro font-mono uppercase tracking-wider text-muted-foreground tabular-nums"
                  >
                    {p.points} pts
                  </span>
                </div>
              </div>
              <div class="hidden sm:block">
                <div
                  class="text-micro font-mono uppercase tracking-wider text-muted-foreground"
                >
                  {m.contestDetail_problemDifficultyLabel()}
                </div>
                <div
                  class="mt-1 h-1.5 rounded-full overflow-hidden"
                  style="background: var(--muted);"
                >
                  <div
                    class="h-full rounded-full"
                    style="width: {Math.min(100, (p.points / 1000) * 100)}%; background: var(--primary);"
                  ></div>
                </div>
              </div>
              <span
                class="text-caption font-medium px-3 py-1.5 rounded-md border text-muted-foreground"
                style="border-color: var(--border-subtle); {enterHref ? '' : 'opacity: 0.5;'}"
              >
                {enterHref ? m.contestDetail_problemSolveCta() : "🔒"}
              </span>
            </a>
          {/each}
        {/if}
      </div>
    </GlassPanel>

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
        Clarifications
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
