<script lang="ts">
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/stores";
  import { Trophy } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import Section from "$lib/components/ui/Section.svelte";
  import { Card } from "$lib/components/ui/card/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";

  let { data } = $props();
  let scoreboard = $derived(data.scoreboard);
  let chart = $derived(data.chart);
  let contestId = $derived($page.params.contestId);

  let unfreezing = $state(false);
  let lastRefreshed = $state(Date.now());
  let justRefreshed = $state(false);

  // Auto-refresh scoreboard every 30 seconds
  const AUTO_REFRESH_MS = 30_000;

  onMount(() => {
    const interval = setInterval(async () => {
      await invalidateAll();
      lastRefreshed = Date.now();
      justRefreshed = true;
      setTimeout(() => {
        justRefreshed = false;
      }, 1200);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  });

  async function handleUnfreeze() {
    unfreezing = true;
    try {
      const res = await fetch(`/api/contests/${contestId}/scoreboard/unfreeze`, {
        method: "POST",
        headers: { "X-Requested-With": "fetch" }
      });
      if (res.ok) {
        await invalidateAll();
      }
    } finally {
      unfreezing = false;
    }
  }

  // ─── Chart helpers ───────────────────────────────────────────────

  // Use warm-palette chart tokens from app.css
  const chartColors = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)"
  ];

  function buildChartPaths(
    series: typeof chart.series,
    width: number,
    height: number,
    padding: number
  ) {
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
          return `${x},${y}`;
        })
        .join(" ");
      return {
        color: chartColors[i % chartColors.length],
        username: s.username,
        points
      };
    });
  }

  let chartPaths = $derived(buildChartPaths(chart.series, 800, 300, 40));

  // ─── ICPC display helpers ────────────────────────────────────────

  function formatIcpcCell(ps: { score: number; attempts: number; firstAcTime: number | null; isPending: boolean }) {
    if (ps.isPending) return "?";
    if (ps.firstAcTime != null) {
      const minutes = Math.floor(ps.firstAcTime / 60);
      if (ps.attempts === 0) return `+ (${minutes}m)`;
      return `+${ps.attempts} (${minutes}m)`;
    }
    if (ps.attempts > 0) return `-${ps.attempts}`;
    return "";
  }

  function icpcCellClass(ps: { score: number; firstAcTime: number | null; isPending: boolean }) {
    if (ps.isPending) return "bg-info/10 text-info";
    if (ps.firstAcTime != null) return "bg-success/10 text-success font-semibold";
    if (ps.score === 0 && ps.firstAcTime == null) return "bg-destructive/10 text-destructive";
    return "text-muted-foreground";
  }

  // ─── IOI display helpers ─────────────────────────────────────────

  function ioiScoreClass(score: number, maxPoints: number) {
    if (maxPoints === 0) return "bg-muted text-muted-foreground";
    const ratio = score / maxPoints;
    if (ratio >= 1) return "bg-success/15 text-success";
    if (ratio > 0) return "bg-warning/15 text-warning";
    return "bg-destructive/15 text-destructive";
  }
</script>

<div class="space-y-6">
  <Section>
    {#snippet header()}
      <p class="text-caption uppercase tracking-wide text-muted-foreground">
        {m.contestDetail_contestZone()} / {contestId}
      </p>
      <h1 class="font-display text-title-lg">{m.contestDetail_scoreboard()}</h1>
    {/snippet}
    {#snippet actions()}
      <span
        class="text-caption text-muted-foreground tabular-nums transition-opacity duration-normal ease-out-soft {justRefreshed
          ? 'opacity-100'
          : 'opacity-60'}"
        aria-live="polite"
      >
        {m.scoreboard_updated()}
      </span>
      {#if scoreboard.isFrozen}
        <Badge variant="info">{m.contestDetail_frozen()}</Badge>
      {/if}
      {#if data.canUnfreeze && scoreboard.frozenAt}
        <Button
          variant="outline"
          disabled={unfreezing}
          loading={unfreezing}
          onclick={handleUnfreeze}
        >
          {m.scoreboard_unfreeze()}
        </Button>
      {/if}
    {/snippet}
  </Section>

  <!-- Score Chart -->
  {#if chart.series.length > 0}
    <Card variant="surface" size="lg">
      <h3 class="text-body-sm font-medium text-muted-foreground">
        {m.scoreboard_scoreProgress()} ({m.scoreboard_top()} {chart.series.length})
      </h3>
      <div class="overflow-x-auto rounded-sm bg-[color:var(--color-panel-strong)] p-3">
        <svg viewBox="0 0 800 300" class="h-auto w-full min-w-[600px]">
          <line
            x1="40"
            y1="260"
            x2="760"
            y2="260"
            stroke="currentColor"
            stroke-opacity="0.15"
          />
          <line
            x1="40"
            y1="40"
            x2="40"
            y2="260"
            stroke="currentColor"
            stroke-opacity="0.15"
          />

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
                style="background:{path.color}"
              ></span>
              <span class="tabular-nums">{path.username}</span>
            </div>
          {/each}
        </div>
      </div>
    </Card>
  {/if}

  <!-- Scoreboard Table -->
  {#if scoreboard.entries.length === 0}
    <EmptyState
      variant="minimal"
      icon={Trophy}
      title={m.scoreboard_empty()}
      description={m.scoreboard_emptyHint()}
    />
  {:else if scoreboard.scoringMode === "problem_count"}
    <!-- Problem-count (ICPC-style) Table -->
    <Card variant="surface" size="lg">
      <div class="overflow-x-auto rounded-sm border border-border-subtle">
        <table class="w-full text-body-sm">
          <thead>
            <tr class="border-b border-border-subtle bg-[color:var(--color-panel-strong)]">
              <th
                class="px-3 py-2.5 text-left text-caption uppercase tracking-wide text-muted-foreground font-medium"
                >#</th
              >
              <th
                class="px-3 py-2.5 text-left text-caption uppercase tracking-wide text-muted-foreground font-medium"
                >{m.scoreboard_user()}</th
              >
              <th
                class="px-3 py-2.5 text-right text-caption uppercase tracking-wide text-muted-foreground font-medium"
                >{m.scoreboard_solved()}</th
              >
              <th
                class="px-3 py-2.5 text-right text-caption uppercase tracking-wide text-muted-foreground font-medium"
                >{m.scoreboard_penalty()}</th
              >
              {#each scoreboard.problems as prob (prob.id)}
                <th
                  class="px-3 py-2.5 text-center text-caption uppercase tracking-wide text-muted-foreground font-medium"
                >
                  <a href="/problems/{prob.id}" class="hover:underline hover:text-foreground transition-colors duration-fast ease-out-soft">
                    {String.fromCharCode(65 + prob.ordinal)}
                  </a>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each scoreboard.entries as entry (entry.username)}
              <tr
                class="border-b border-border-subtle last:border-b-0 transition-colors duration-fast ease-out-soft hover:bg-accent/40"
              >
                <td class="px-3 py-2 font-display text-title-sm font-semibold tabular-nums">
                  {entry.rank}
                </td>
                <td class="px-3 py-2">
                  <span class="font-medium">{entry.username}</span>
                  {#if entry.isFirstBlood.some(Boolean)}
                    <span class="ml-1 text-warning" title={m.contestDetail_firstBlood()}>&#9733;</span>
                  {/if}
                </td>
                <td class="px-3 py-2 text-right font-mono tabular-nums font-semibold">
                  {entry.totalScore}
                </td>
                <td class="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {entry.totalPenalty}
                </td>
                {#each entry.problems as ps, pi (pi)}
                  <td class="px-3 py-2 text-center font-mono tabular-nums {icpcCellClass(ps)}">
                    <span>
                      {formatIcpcCell(ps)}
                      {#if entry.isFirstBlood[pi]}
                        <span class="ml-0.5 text-warning" title={m.contestDetail_firstBlood()}>&#9733;</span>
                      {/if}
                    </span>
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </Card>
  {:else}
    <!-- IOI Table -->
    <Card variant="surface" size="lg">
      <div class="overflow-x-auto rounded-sm border border-border-subtle">
        <table class="w-full text-body-sm">
          <thead>
            <tr class="border-b border-border-subtle bg-[color:var(--color-panel-strong)]">
              <th
                class="px-3 py-2.5 text-left text-caption uppercase tracking-wide text-muted-foreground font-medium"
                >#</th
              >
              <th
                class="px-3 py-2.5 text-left text-caption uppercase tracking-wide text-muted-foreground font-medium"
                >{m.scoreboard_user()}</th
              >
              <th
                class="px-3 py-2.5 text-right text-caption uppercase tracking-wide text-muted-foreground font-medium"
                >{m.scoreboard_total()}</th
              >
              {#each scoreboard.problems as prob (prob.id)}
                <th
                  class="px-3 py-2.5 text-center text-caption uppercase tracking-wide text-muted-foreground font-medium"
                >
                  <a href="/problems/{prob.id}" class="hover:underline hover:text-foreground transition-colors duration-fast ease-out-soft">
                    {String.fromCharCode(65 + prob.ordinal)}
                  </a>
                  <span class="block text-caption font-normal text-muted-foreground tabular-nums">
                    {prob.points}
                  </span>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each scoreboard.entries as entry (entry.username)}
              <tr
                class="border-b border-border-subtle last:border-b-0 transition-colors duration-fast ease-out-soft hover:bg-accent/40"
              >
                <td class="px-3 py-2 font-display text-title-sm font-semibold tabular-nums">
                  {entry.rank}
                </td>
                <td class="px-3 py-2">
                  <span class="font-medium">{entry.username}</span>
                  {#if entry.isFirstBlood.some(Boolean)}
                    <span class="ml-1 text-warning" title={m.contestDetail_firstBlood()}>&#9733;</span>
                  {/if}
                </td>
                <td class="px-3 py-2 text-right font-mono tabular-nums font-semibold">
                  {entry.totalScore}
                </td>
                {#each entry.problems as ps, pi (pi)}
                  {@const prob = scoreboard.problems[pi]}
                  <td class="px-3 py-2 text-center">
                    {#if ps.isPending}
                      <span class="inline-block rounded-xs px-2 py-0.5 text-caption font-medium bg-info/15 text-info">
                        ?
                      </span>
                    {:else}
                      <span class="inline-block rounded-xs px-2 py-0.5 text-caption font-mono font-medium tabular-nums {ioiScoreClass(ps.score, prob?.points ?? 100)}">
                        {ps.score}
                        {#if entry.isFirstBlood[pi]}
                          <span class="text-warning" title={m.contestDetail_firstBlood()}>&#9733;</span>
                        {/if}
                      </span>
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </Card>
  {/if}
</div>
