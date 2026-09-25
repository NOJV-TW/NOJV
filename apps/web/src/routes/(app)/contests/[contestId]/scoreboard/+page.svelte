<script lang="ts" module>
  const RANK_COLUMN_WIDTH = 64;
  const PARTICIPANT_COLUMN_WIDTH = 196;
  const PROBLEM_COLUMN_WIDTH = 104;
  const SUMMARY_COLUMN_WIDTH = 96;

  function tableMinWidth(problemCount: number, summaryColumns: number): string {
    return `${RANK_COLUMN_WIDTH + PARTICIPANT_COLUMN_WIDTH + problemCount * PROBLEM_COLUMN_WIDTH + summaryColumns * SUMMARY_COLUMN_WIDTH}px`;
  }

  const chartColors = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ];
</script>

<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { flip } from "svelte/animate";
  import { cubicOut } from "svelte/easing";
  import { Trophy } from "@lucide/svelte";
  import { invalidate } from "$app/navigation";
  import { page } from "$app/state";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";
  import { entriesAroundUser } from "$lib/utils/scoreboard";
  import { problemLetter } from "$lib/components/features/contest/format";
  import { Button } from "$lib/components/primitives/ui/button/index.js";
  import Crumbs from "$lib/components/primitives/visual/Crumbs.svelte";
  import GlassPanel from "$lib/components/primitives/visual/GlassPanel.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import RankBadge from "$lib/components/primitives/visual/RankBadge.svelte";
  import TabStrip from "$lib/components/primitives/visual/TabStrip.svelte";
  import SolveCountCell from "$lib/components/features/contest/SolveCountCell.svelte";
  import PointSumCell from "$lib/components/features/contest/PointSumCell.svelte";
  import ScoreProgressChart from "$lib/components/features/contest/ScoreProgressChart.svelte";

  let { data } = $props();
  const scoreboard = $derived(data.scoreboard);
  const chart = $derived(data.chart);
  const contestId = $derived(page.params.contestId ?? "");

  const isSolveCount = $derived(scoreboard.scoringMode === "problem_count");

  let unfreezing = $state(false);
  let lastRefreshed = $state(Date.now());
  let justRefreshed = $state(false);
  let refreshing = $state(false);
  let nowTick = $state(Date.now());

  const secondsSinceRefresh = $derived(
    Math.max(0, Math.round((nowTick - lastRefreshed) / 1000)),
  );

  const AUTO_REFRESH_MS = 30_000;
  const SSE_DEBOUNCE_MS = 1500;
  $effect(() => {
    const currentContestId = contestId;
    async function refresh() {
      refreshing = true;
      try {
        await invalidate("contest:scoreboard");
      } finally {
        refreshing = false;
      }
      lastRefreshed = Date.now();
      nowTick = Date.now();
      justRefreshed = true;
      setTimeout(() => {
        justRefreshed = false;
      }, 1200);
    }

    const tick = setInterval(() => {
      nowTick = Date.now();
    }, 1000);

    let debounce: ReturnType<typeof setTimeout> | null = null;
    function debouncedRefresh() {
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = null;
        if (document.visibilityState === "visible") void refresh();
      }, SSE_DEBOUNCE_MS);
    }

    const source = new EventSource(`/contests/${currentContestId}/scoreboard/stream`);
    source.onmessage = () => debouncedRefresh();

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, AUTO_REFRESH_MS);

    function onVisibility() {
      if (document.visibilityState === "visible") void refresh();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      source.close();
      clearInterval(interval);
      clearInterval(tick);
      if (debounce) clearTimeout(debounce);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });

  async function handleUnfreeze() {
    unfreezing = true;
    try {
      const fd = new FormData();
      const res = await fetch("?/unfreeze", { method: "POST", body: fd });
      if (!res.ok) {
        toasts.error(m.contestScoreboard_unfreezeError());
        return;
      }
      await invalidate("contest:scoreboard");
    } catch {
      toasts.error(m.contestScoreboard_unfreezeError());
    } finally {
      unfreezing = false;
    }
  }

  const myUsername = $derived(page.data.user?.username ?? null);
  const myRow = $derived(
    myUsername == null
      ? null
      : (scoreboard.entries.find((e) => e.username === myUsername) ?? null),
  );

  const AROUND_ME_RADIUS = 5;
  let scoreboardFilter = $state<"all" | "around">("all");
  const displayEntries = $derived(
    scoreboardFilter === "around"
      ? entriesAroundUser(scoreboard.entries, myRow?.userId ?? null, AROUND_ME_RADIUS)
      : scoreboard.entries,
  );

  function avatarBg(name: string): string {
    const code = name.charCodeAt(0) || 65;
    const token = chartColors[code % chartColors.length] ?? "var(--chart-1)";
    return `color-mix(in oklab, ${token} 65%, var(--panel))`;
  }

  function stickyBg(isMe: boolean): string {
    const base = "linear-gradient(var(--panel), var(--panel)), var(--background)";
    return isMe
      ? `linear-gradient(color-mix(in oklab, var(--primary) 8%, transparent), color-mix(in oklab, var(--primary) 8%, transparent)), ${base}`
      : base;
  }

  let prefersReducedMotion = $state(false);
  $effect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    prefersReducedMotion = mq.matches;
    const handler = (e: MediaQueryListEvent) => {
      prefersReducedMotion = e.matches;
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  });

  let selectedChartUserId = $state<string | null>(null);

  let rankPulse = $state(false);
  let prevRank: number | null = null;
  let pulseTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const r = myRow?.rank ?? null;
    untrack(() => {
      if (prevRank !== null && r !== null && r !== prevRank) {
        rankPulse = true;
        if (pulseTimer) clearTimeout(pulseTimer);
        pulseTimer = setTimeout(() => (rankPulse = false), 800);
      }
      prevRank = r;
    });
  });
</script>

<PageContainer class="space-y-6 fade-up">
  <Crumbs
    items={[
      { label: m.navigation_contests(), href: "/contests" },
      { label: contestId, href: `/contests/${contestId}` },
      { label: m.contestDetail_scoreboard() },
    ]}
  />

  <GlassPanel class="overflow-hidden">
    <div
      class="flex items-center justify-between px-6 py-4 border-b gap-4 flex-wrap"
      style="border-color: var(--border-subtle);"
    >
      <div class="flex items-baseline gap-2.5">
        <h2 class="text-title font-semibold">{m.contestScoreboard_panelHeading()}</h2>
        <span
          class="font-mono text-micro uppercase tracking-wider px-2 py-0.5 rounded-sm"
          style="background: {isSolveCount
            ? 'color-mix(in oklab, var(--primary) 14%, transparent)'
            : 'color-mix(in oklab, var(--info) 18%, transparent)'}; color: {isSolveCount
            ? 'var(--primary)'
            : 'var(--info)'};"
        >
          {isSolveCount
            ? m.contestScoreboard_formatSolveCount()
            : m.contestScoreboard_formatPointSum()}
        </span>
        <span class="text-caption text-muted-foreground hidden sm:inline">
          {isSolveCount
            ? m.contestScoreboard_sortHintSolveCount()
            : m.contestScoreboard_sortHintPointSum()}
        </span>
        {#if scoreboard.isFrozen}
          <span class="flex items-center gap-1.5 text-caption text-info">
            <span class="size-1.5 rounded-full bg-info"></span>
            {m.contestScoreboard_frozenNote()}
          </span>
        {/if}
      </div>
      <div class="flex items-center gap-3">
        <span
          class="flex items-center gap-1.5 text-caption text-muted-foreground tabular-nums transition-opacity {justRefreshed
            ? 'opacity-100'
            : 'opacity-60'}"
          title={m.contestScoreboard_autoRefresh()}
          aria-live="polite"
        >
          <span
            class="size-1.5 rounded-full"
            style="background: {refreshing ? 'var(--info)' : 'var(--success)'};"
          ></span>
          {#if refreshing}
            {m.contestScoreboard_updating()}
          {:else if secondsSinceRefresh < 5}
            {m.contestScoreboard_updatedJustNow()}
          {:else}
            {m.contestScoreboard_updatedAgo({ seconds: secondsSinceRefresh })}
          {/if}
        </span>
        {#if data.canUnfreeze && scoreboard.frozenAt}
          <Button
            variant="outline"
            size="sm"
            disabled={unfreezing}
            loading={unfreezing}
            onclick={handleUnfreeze}
          >
            {m.contestScoreboard_unfreezeButton()}
          </Button>
        {/if}
        {#if myRow}
          <TabStrip
            tabs={[
              { value: "all", label: m.contestScoreboard_filterAll() },
              { value: "around", label: m.contestScoreboard_filterAround() },
            ]}
            activeTabValue={scoreboardFilter}
            onChange={(v) => (scoreboardFilter = v === "around" ? "around" : "all")}
          />
        {/if}
      </div>
    </div>

    {#if scoreboard.entries.length === 0}
      <EmptyState icon={Trophy} title={m.contestScoreboard_empty()} />
    {:else if isSolveCount}
      <div class="overflow-auto max-h-[70vh]">
        <table
          class="w-full table-fixed text-body-sm"
          style="min-width: {tableMinWidth(scoreboard.problems.length, 1)};"
        >
          <colgroup>
            <col style="width: {RANK_COLUMN_WIDTH}px;" />
            <col style="width: {PARTICIPANT_COLUMN_WIDTH}px;" />
            <col style="width: {SUMMARY_COLUMN_WIDTH}px;" />
            {#each scoreboard.problems as p (p.id)}
              <col style="width: {PROBLEM_COLUMN_WIDTH}px;" />
            {/each}
          </colgroup>
          <thead>
            <tr class="text-micro font-mono uppercase tracking-wider text-muted-foreground">
              <th class="sticky left-0 top-0 z-30 bg-muted text-left px-2 py-3 w-16">#</th>
              <th class="sticky left-16 top-0 z-30 bg-muted text-left px-4 py-3"
                >{m.contestScoreboard_colParticipant()}</th
              >
              <th class="sticky top-0 z-20 bg-muted text-center px-3 py-3">
                {m.contestScoreboard_colScore()}
              </th>
              {#each scoreboard.problems as p (p.id)}
                <th class="sticky top-0 z-20 bg-muted text-center px-2 py-3">
                  <div class="font-bold text-foreground">
                    {problemLetter(p.ordinal)}
                  </div>
                  <div class="normal-case text-caption mt-0.5 truncate" title={p.title}>
                    {p.title}
                  </div>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody class="divide-y" style="border-color: var(--border-subtle);">
            {#each displayEntries as r (r.username)}
              <tr
                animate:flip={{ duration: prefersReducedMotion ? 0 : 320, easing: cubicOut }}
                class="transition-colors {r.userId === myRow?.userId
                  ? rankPulse
                    ? 'motion-safe:animate-[pulse-soft_0.7s_ease-in-out]'
                    : ''
                  : 'hover:bg-muted/40'}"
                style={r.userId === myRow?.userId
                  ? "background: color-mix(in oklab, var(--primary) 8%, transparent); outline: 1px solid color-mix(in oklab, var(--primary) 25%, transparent);"
                  : ""}
              >
                <td
                  class="sticky left-0 z-20 px-2 py-3 align-middle"
                  style="background: {stickyBg(r.userId === myRow?.userId)};"
                >
                  <RankBadge rank={r.rank} />
                </td>
                <td
                  class="sticky left-16 z-10 px-4 py-3 align-middle"
                  style="background: {stickyBg(r.userId === myRow?.userId)};"
                >
                  <div class="flex items-center gap-2.5">
                    <div
                      class="size-7 rounded-full"
                      style="background: {avatarBg(r.username)};"
                    ></div>
                    <button
                      type="button"
                      class="truncate text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      class:font-semibold={r.userId === myRow?.userId}
                      style={r.userId === myRow?.userId ? "color: var(--primary);" : ""}
                      onclick={() => (selectedChartUserId = r.userId)}
                    >
                      {r.username}
                    </button>
                    {#if r.userId === myRow?.userId}
                      <span
                        class="text-micro font-mono uppercase tracking-wider"
                        style="color: var(--primary);"
                      >
                        {m.results_youBadge()}
                      </span>
                    {/if}
                  </div>
                </td>
                <td class="px-3 py-3 text-center font-mono tabular-nums">
                  <div class="flex flex-col items-center leading-tight">
                    <span class="text-title-sm font-semibold">{r.totalScore}</span>
                    <span class="text-caption text-muted-foreground">
                      {Math.round(r.totalPenalty / 60)}
                    </span>
                  </div>
                </td>
                {#each r.problems as ps, pi (pi)}
                  <td class="p-0 text-center">
                    <SolveCountCell
                      firstAcTime={ps.firstAcTime}
                      attempts={ps.attempts}
                      isPending={ps.isPending}
                      isFirstBlood={r.isFirstBlood[pi] ?? false}
                    />
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="overflow-auto max-h-[70vh]">
        <table
          class="w-full table-fixed text-body-sm"
          style="min-width: {tableMinWidth(scoreboard.problems.length, 1)};"
        >
          <colgroup>
            <col style="width: {RANK_COLUMN_WIDTH}px;" />
            <col style="width: {PARTICIPANT_COLUMN_WIDTH}px;" />
            {#each scoreboard.problems as p (p.id)}
              <col style="width: {PROBLEM_COLUMN_WIDTH}px;" />
            {/each}
            <col style="width: {SUMMARY_COLUMN_WIDTH}px;" />
          </colgroup>
          <thead>
            <tr class="text-micro font-mono uppercase tracking-wider text-muted-foreground">
              <th class="sticky left-0 top-0 z-30 bg-muted text-left px-2 py-3 w-16">#</th>
              <th class="sticky left-16 top-0 z-30 bg-muted text-left px-4 py-3"
                >{m.contestScoreboard_colParticipant()}</th
              >
              {#each scoreboard.problems as p (p.id)}
                <th class="sticky top-0 z-20 bg-muted text-center px-3 py-3">
                  <div class="font-bold text-foreground">
                    {problemLetter(p.ordinal)}
                  </div>
                  <div
                    class="block font-normal text-muted-foreground tabular-nums text-caption mt-0.5"
                  >
                    {p.points}
                  </div>
                </th>
              {/each}
              <th class="sticky top-0 z-20 bg-muted text-right px-4 py-3 w-24"
                >{m.contestScoreboard_colTotal()}</th
              >
            </tr>
          </thead>
          <tbody class="divide-y" style="border-color: var(--border-subtle);">
            {#each displayEntries as r (r.username)}
              <tr
                animate:flip={{ duration: prefersReducedMotion ? 0 : 320, easing: cubicOut }}
                class="transition-colors {r.userId === myRow?.userId
                  ? rankPulse
                    ? 'motion-safe:animate-[pulse-soft_0.7s_ease-in-out]'
                    : ''
                  : 'hover:bg-muted/40'}"
                style={r.userId === myRow?.userId
                  ? "background: color-mix(in oklab, var(--primary) 8%, transparent); outline: 1px solid color-mix(in oklab, var(--primary) 25%, transparent);"
                  : ""}
              >
                <td
                  class="sticky left-0 z-20 px-2 py-3 align-middle"
                  style="background: {stickyBg(r.userId === myRow?.userId)};"
                >
                  <RankBadge rank={r.rank} />
                </td>
                <td
                  class="sticky left-16 z-10 px-4 py-3 align-middle"
                  style="background: {stickyBg(r.userId === myRow?.userId)};"
                >
                  <div class="flex items-center gap-2.5">
                    <div
                      class="size-7 rounded-full"
                      style="background: {avatarBg(r.username)};"
                    ></div>
                    <button
                      type="button"
                      class="truncate text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      class:font-semibold={r.userId === myRow?.userId}
                      style={r.userId === myRow?.userId ? "color: var(--primary);" : ""}
                      onclick={() => (selectedChartUserId = r.userId)}
                    >
                      {r.username}
                    </button>
                    {#if r.userId === myRow?.userId}
                      <span
                        class="text-micro font-mono uppercase tracking-wider"
                        style="color: var(--primary);"
                      >
                        {m.results_youBadge()}
                      </span>
                    {/if}
                  </div>
                </td>
                {#each r.problems as ps, pi (pi)}
                  <td class="p-0 text-center">
                    <PointSumCell
                      firstAcTime={ps.firstAcTime}
                      score={ps.score}
                      attempts={ps.attempts}
                      isPending={ps.isPending}
                      isFirstBlood={r.isFirstBlood[pi] ?? false}
                    />
                  </td>
                {/each}
                <td
                  class="px-4 py-3 text-right font-mono tabular-nums font-semibold text-title-sm"
                >
                  {r.totalScore}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    {#if scoreboard.entries.length > 0}
      <div
        class="px-6 py-3 border-t flex flex-wrap items-center gap-x-5 gap-y-2 text-micro font-mono uppercase tracking-wider text-muted-foreground"
        style="border-color: var(--border-subtle);"
      >
        {#if isSolveCount}
          <span class="flex items-center gap-1.5">
            <span
              class="size-2.5 rounded"
              style="background: color-mix(in oklab, var(--success) 30%, transparent);"
            ></span>
            {m.contestScoreboard_legendAc()}
          </span>
          <span class="flex items-center gap-1.5">
            <span class="size-2.5 rounded" style="background: var(--success-strong);"></span>
            {m.contestScoreboard_legendFirstBlood()}
          </span>
          <span class="flex items-center gap-1.5">
            <span
              class="size-2.5 rounded"
              style="background: color-mix(in oklab, var(--destructive) 25%, transparent);"
            ></span>
            {m.contestScoreboard_legendWa()}
          </span>
          <span class="flex items-center gap-1.5">
            <span class="size-2.5 rounded bg-muted"></span>
            {m.contestScoreboard_legendUntried()}
          </span>
          <span class="ml-auto">{m.contestScoreboard_legendPenaltyFormula()}</span>
        {:else}
          <span class="flex items-center gap-1.5">
            <span
              class="size-2.5 rounded"
              style="background: color-mix(in oklab, var(--success) 30%, transparent);"
            ></span>
            {m.contestScoreboard_legendScoredAc()}
          </span>
          <span class="flex items-center gap-1.5">
            <span class="size-2.5 rounded" style="background: var(--success-strong);"></span>
            {m.contestScoreboard_legendFirstBlood()}
          </span>
          <span class="flex items-center gap-1.5">
            <span
              class="size-2.5 rounded"
              style="background: color-mix(in oklab, var(--destructive) 25%, transparent);"
            ></span>
            {m.contestScoreboard_legendScoredWa()}
          </span>
          <span class="flex items-center gap-1.5">
            <span class="size-2.5 rounded bg-muted"></span>
            {m.contestScoreboard_legendUntried()}
          </span>
          <span class="ml-auto">{m.contestScoreboard_legendDecayFormula()}</span>
        {/if}
      </div>
    {/if}
  </GlassPanel>

  {#if chart.series.length > 0}
    <ScoreProgressChart
      bind:selectedUserId={selectedChartUserId}
      series={chart.series}
      durationSeconds={Math.max(
        1,
        Math.floor(
          (new Date(data.endsAt).getTime() - new Date(data.startsAt).getTime()) / 1000,
        ),
      )}
    />
  {/if}
</PageContainer>
