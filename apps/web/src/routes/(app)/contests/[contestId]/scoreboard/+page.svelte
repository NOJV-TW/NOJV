<script lang="ts" module>
  const chartColors = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ];

  export function buildChartPaths(
    series: { username: string; points: { time: number; score: number }[] }[],
    width: number,
    height: number,
    padding: number,
  ): { color: string; username: string; points: string }[] {
    if (series.length === 0) return [];
    let maxTime = 0;
    let maxScore = 0;
    for (const s of series) {
      for (const pt of s.points) {
        if (pt.time > maxTime) maxTime = pt.time;
        if (pt.score > maxScore) maxScore = pt.score;
      }
    }
    if (maxTime === 0) maxTime = 1;
    if (maxScore === 0) maxScore = 1;

    const plotW = width - padding * 2;
    const plotH = height - padding * 2;

    return series.map((s, i) => {
      const points = s.points
        .map((pt) => {
          const x = padding + (pt.time / maxTime) * plotW;
          const y = height - padding - (pt.score / maxScore) * plotH;
          return `${String(x)},${String(y)}`;
        })
        .join(" ");
      return {
        color: chartColors[i % chartColors.length] ?? "var(--chart-1)",
        username: s.username,
        points,
      };
    });
  }
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button/index.js";
  import Crumbs from "$lib/components/primitives/visual/Crumbs.svelte";
  import GlassPanel from "$lib/components/primitives/visual/GlassPanel.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import RankBadge from "$lib/components/primitives/visual/RankBadge.svelte";
  import SolveCountCell from "$lib/components/features/contest/SolveCountCell.svelte";
  import PointSumCell from "$lib/components/features/contest/PointSumCell.svelte";

  let { data } = $props();
  const scoreboard = $derived(data.scoreboard);
  const chart = $derived(data.chart);
  const contestId = $derived(page.params.contestId ?? "");

  const isSolveCount = $derived(scoreboard.scoringMode === "problem_count");

  let unfreezing = $state(false);
  let lastRefreshed = $state(Date.now());
  let justRefreshed = $state(false);

  const AUTO_REFRESH_MS = 30_000;
  const SSE_DEBOUNCE_MS = 1500;
  onMount(() => {
    async function refresh() {
      await invalidateAll();
      lastRefreshed = Date.now();
      justRefreshed = true;
      setTimeout(() => {
        justRefreshed = false;
      }, 1200);
    }

    let debounce: ReturnType<typeof setTimeout> | null = null;
    function debouncedRefresh() {
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = null;
        if (document.visibilityState === "visible") void refresh();
      }, SSE_DEBOUNCE_MS);
    }

    const source = new EventSource(`/contests/${contestId}/scoreboard/stream`);
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
      if (debounce) clearTimeout(debounce);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });

  async function handleUnfreeze() {
    unfreezing = true;
    try {
      const fd = new FormData();
      const res = await fetch("?/unfreeze", { method: "POST", body: fd });
      if (res.ok) {
        await invalidateAll();
      }
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

  function avatarBg(name: string): string {
    const code = name.charCodeAt(0) || 65;
    return `hsl(${String((code * 7) % 360)} 30% 65%)`;
  }

  const chartPaths = $derived(buildChartPaths(chart.series, 800, 300, 40));
</script>

<PageContainer class="space-y-6 fade-up">
  <Crumbs
    items={[
      { label: m.navigation_contests(), href: "/contests" },
      { label: contestId, href: `/contests/${contestId}` },
      { label: m.contestDetail_scoreboard() },
    ]}
  />

  <div class="glass rounded-xl shadow-rest p-4 flex flex-wrap items-center gap-6">
    <div class="flex-1 min-w-0">
      <div
        class="flex items-center gap-2 text-micro font-mono uppercase tracking-[0.2em] text-muted-foreground"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M8 4h8v3a4 4 0 0 1-8 0V4z" />
          <path d="M16 5h3v2a3 3 0 0 1-3 3M8 5H5v2a3 3 0 0 0 3 3" />
          <path d="M10 11v4M14 11v4" />
          <path d="M8 20h8M9 20l1-3h4l1 3" />
        </svg>
        <span
          >Scoreboard · {isSolveCount
            ? m.contestScoreboard_formatSolveCount()
            : m.contestScoreboard_formatPointSum()}</span
        >
      </div>
      <h1 class="mt-2 text-headline font-semibold tracking-tight">
        {m.contestScoreboard_heroHeading()}
      </h1>
      <p class="text-caption text-muted-foreground">
        {isSolveCount
          ? m.contestScoreboard_heroHintSolveCount()
          : m.contestScoreboard_heroHintPointSum()}
      </p>
    </div>

    {#if scoreboard.isFrozen}
      <div
        class="rounded-lg border border-dashed p-2 min-w-[200px]"
        style="border-color: color-mix(in oklab, var(--destructive) 35%, transparent);"
      >
        <div
          class="flex items-center gap-2 text-micro font-mono uppercase tracking-wider text-muted-foreground"
        >
          <span class="size-1.5 rounded-full live-dot" style="background: oklch(0.55 0.2 27);"
          ></span>
          <span>{m.contestDetail_frozen().toUpperCase()}</span>
        </div>
        <div class="mt-1 font-mono text-caption text-muted-foreground">
          {m.contestScoreboard_frozenNote()}
        </div>
      </div>
    {/if}

    <div class="grid grid-cols-3 gap-5 text-center">
      <div>
        <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
          {m.contestScoreboard_kpiEntries()}
        </div>
        <div class="mt-1 text-title font-semibold tabular-nums">
          {scoreboard.entries.length}
        </div>
      </div>
      <div>
        <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
          {m.contestScoreboard_kpiProblems()}
        </div>
        <div class="mt-1 text-title font-semibold tabular-nums">
          {scoreboard.problems.length}
        </div>
      </div>
      <div>
        <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
          {m.contestScoreboard_kpiYourRank()}
        </div>
        <div class="mt-1 text-title font-semibold tabular-nums" style="color: var(--primary);">
          #{myRow?.rank ?? "—"}
        </div>
      </div>
    </div>
  </div>

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
            ? 'color-mix(in oklab, #c4682d 14%, transparent)'
            : 'color-mix(in oklab, var(--chart-3) 18%, transparent)'}; color: {isSolveCount
            ? '#c4682d'
            : 'oklch(0.45 0.13 245)'};"
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
      </div>
      <div class="flex items-center gap-3">
        <span
          class="text-caption text-muted-foreground tabular-nums transition-opacity {justRefreshed
            ? 'opacity-100'
            : 'opacity-60'}"
          aria-live="polite"
        >
          {m.contestScoreboard_autoRefresh()}
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
      </div>
    </div>

    {#if scoreboard.entries.length === 0}
      <div class="px-6 py-16 text-center text-body-sm text-muted-foreground">
        {m.contestScoreboard_empty()}
      </div>
    {:else if isSolveCount}
      <div class="overflow-x-auto">
        <table class="w-full text-body-sm">
          <thead>
            <tr
              class="text-micro font-mono uppercase tracking-wider text-muted-foreground"
              style="background: color-mix(in oklab, var(--muted) 60%, transparent);"
            >
              <th class="text-left px-6 py-3 w-16">#</th>
              <th class="text-left px-4 py-3">{m.contestScoreboard_colParticipant()}</th>
              <th class="text-center px-3 py-3 w-20">{m.contestScoreboard_colSolved()}</th>
              <th class="text-center px-3 py-3 w-24">{m.contestScoreboard_colPenalty()}</th>
              {#each scoreboard.problems as p (p.id)}
                <th class="text-center px-2 py-3 w-[72px]">
                  <div class="font-bold text-foreground">
                    {String.fromCharCode(65 + p.ordinal)}
                  </div>
                  <div
                    class="opacity-50 normal-case text-[10px] mt-0.5 truncate"
                    title={p.title}
                  >
                    {p.title}
                  </div>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody class="divide-y" style="border-color: var(--border-subtle);">
            {#each scoreboard.entries as r (r.username)}
              <tr
                class="transition-colors {r.userId === myRow?.userId
                  ? ''
                  : 'hover:bg-muted/40'}"
                style={r.userId === myRow?.userId
                  ? "background: color-mix(in oklab, var(--primary) 8%, transparent); outline: 1px solid color-mix(in oklab, var(--primary) 25%, transparent);"
                  : ""}
              >
                <td class="px-6 py-3 align-middle">
                  <RankBadge rank={r.rank} />
                </td>
                <td class="px-4 py-3 align-middle">
                  <div class="flex items-center gap-2.5">
                    <div
                      class="size-7 rounded-full"
                      style="background: {avatarBg(r.username)};"
                    ></div>
                    <span
                      class={r.userId === myRow?.userId ? "font-semibold" : ""}
                      style={r.userId === myRow?.userId ? "color: var(--primary);" : ""}
                    >
                      {r.username}
                    </span>
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
                <td
                  class="px-3 py-3 text-center font-mono tabular-nums font-semibold text-title-sm"
                >
                  {r.totalScore}
                </td>
                <td class="px-3 py-3 text-center font-mono tabular-nums text-muted-foreground">
                  {Math.round(r.totalPenalty / 60)}
                </td>
                {#each r.problems as ps, pi (pi)}
                  <td class="px-2 py-3 text-center">
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
      <div class="overflow-x-auto">
        <table class="w-full text-body-sm">
          <thead>
            <tr
              class="text-micro font-mono uppercase tracking-wider text-muted-foreground"
              style="background: color-mix(in oklab, var(--muted) 60%, transparent);"
            >
              <th class="text-left px-6 py-3 w-16">#</th>
              <th class="text-left px-4 py-3">{m.contestScoreboard_colParticipant()}</th>
              <th class="text-right px-4 py-3 w-24">{m.contestScoreboard_colTotal()}</th>
              {#each scoreboard.problems as p (p.id)}
                <th class="text-center px-3 py-3 w-24">
                  <div class="font-bold text-foreground">
                    {String.fromCharCode(65 + p.ordinal)}
                  </div>
                  <div
                    class="block font-normal text-muted-foreground tabular-nums text-[10px] mt-0.5"
                  >
                    {p.points}
                  </div>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody class="divide-y" style="border-color: var(--border-subtle);">
            {#each scoreboard.entries as r (r.username)}
              <tr
                class="transition-colors {r.userId === myRow?.userId
                  ? ''
                  : 'hover:bg-muted/40'}"
                style={r.userId === myRow?.userId
                  ? "background: color-mix(in oklab, var(--primary) 8%, transparent); outline: 1px solid color-mix(in oklab, var(--primary) 25%, transparent);"
                  : ""}
              >
                <td class="px-6 py-3 align-middle">
                  <RankBadge rank={r.rank} />
                </td>
                <td class="px-4 py-3 align-middle">
                  <div class="flex items-center gap-2.5">
                    <div
                      class="size-7 rounded-full"
                      style="background: {avatarBg(r.username)};"
                    ></div>
                    <span
                      class={r.userId === myRow?.userId ? "font-semibold" : ""}
                      style={r.userId === myRow?.userId ? "color: var(--primary);" : ""}
                    >
                      {r.username}
                    </span>
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
                <td
                  class="px-4 py-3 text-right font-mono tabular-nums font-semibold text-title-sm"
                >
                  {r.totalScore}
                </td>
                {#each r.problems as ps, pi (pi)}
                  <td class="px-3 py-3 text-center">
                    <PointSumCell
                      firstAcTime={ps.firstAcTime}
                      score={ps.score}
                      attempts={ps.attempts}
                      isPending={ps.isPending}
                    />
                  </td>
                {/each}
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
            <span
              class="inline-grid place-items-center size-3.5 rounded-[2px] text-[8px]"
              style="background: var(--chart-4); color: white;"
            >
              ★
            </span>
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
          <span class="ml-auto opacity-70">{m.contestScoreboard_legendPenaltyFormula()}</span>
        {:else}
          <span class="flex items-center gap-1.5">
            <span
              class="size-2.5 rounded"
              style="background: color-mix(in oklab, var(--success) 30%, transparent);"
            ></span>
            {m.contestScoreboard_legendScoredAc()}
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
          <span class="ml-auto opacity-70">{m.contestScoreboard_legendDecayFormula()}</span>
        {/if}
      </div>
    {/if}
  </GlassPanel>

  {#if chart.series.length > 0}
    <GlassPanel class="p-6">
      <div class="flex items-baseline justify-between mb-3">
        <h3 class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
          {m.contestScoreboard_chartHeading({ count: chart.series.length })}
        </h3>
      </div>
      <div class="overflow-x-auto rounded-sm" style="background: var(--panel-strong);">
        <svg viewBox="0 0 800 300" class="h-auto w-full min-w-[600px]">
          <line
            x1="40"
            y1="260"
            x2="760"
            y2="260"
            stroke="currentColor"
            stroke-opacity="0.15"
          />
          <line x1="40" y1="40" x2="40" y2="260" stroke="currentColor" stroke-opacity="0.15" />
          {#each chartPaths as path (path.username)}
            <polyline
              points={path.points}
              fill="none"
              stroke={path.color}
              stroke-width="2"
              stroke-linejoin="round"
            />
          {/each}
        </svg>
        <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-2">
          {#each chartPaths as path (path.username)}
            <div class="flex items-center gap-1.5 text-caption">
              <span
                class="inline-block h-2.5 w-2.5 rounded-full"
                style="background: {path.color};"
              ></span>
              <span class="tabular-nums">{path.username}</span>
            </div>
          {/each}
        </div>
      </div>
    </GlassPanel>
  {/if}
</PageContainer>
