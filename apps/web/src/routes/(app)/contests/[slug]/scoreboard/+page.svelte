<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/stores";

  let { data } = $props();
  let scoreboard = $derived(data.scoreboard);
  let chart = $derived(data.chart);
  let slug = $derived($page.params.slug);

  let unfreezing = $state(false);

  async function handleUnfreeze() {
    unfreezing = true;
    try {
      const res = await fetch(`/api/contests/${slug}/scoreboard/unfreeze`, {
        method: "POST"
      });
      if (res.ok) {
        await invalidateAll();
      }
    } finally {
      unfreezing = false;
    }
  }

  // ─── Chart helpers ───────────────────────────────────────────────

  const chartColors = [
    "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
    "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1"
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
        handle: s.handle,
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
    if (ps.isPending) return "text-blue-500";
    if (ps.firstAcTime != null) return "text-emerald-600 font-semibold";
    if (ps.score === 0 && ps.firstAcTime == null) return "text-red-500";
    return "";
  }

  // ─── IOI display helpers ─────────────────────────────────────────

  function ioiScoreColor(score: number, maxPoints: number) {
    if (maxPoints === 0) return "bg-neutral-100 dark:bg-neutral-800";
    const ratio = score / maxPoints;
    if (ratio >= 1) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
    if (ratio > 0) return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
    return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
  }
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
        Contest / {slug}
      </p>
      <h2 class="mt-1 font-[family-name:var(--font-display)] text-3xl">
        Scoreboard
      </h2>
    </div>
    <div class="flex items-center gap-3">
      {#if scoreboard.isFrozen}
        <span class="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
          Frozen
        </span>
      {/if}
      {#if data.canUnfreeze && scoreboard.frozenAt}
        <button
          class="rounded-lg border border-border bg-[color:var(--color-panel)] px-4 py-2 text-sm font-medium transition hover:bg-[color:var(--color-panel-strong)] disabled:opacity-50"
          disabled={unfreezing}
          onclick={handleUnfreeze}
        >
          {unfreezing ? "Unfreezing..." : "Unfreeze Board"}
        </button>
      {/if}
    </div>
  </div>

  <!-- Score Chart -->
  {#if chart.series.length > 0}
    <section class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-4">
      <h3 class="mb-3 text-sm font-medium text-muted-foreground">Score Progress (Top {chart.series.length})</h3>
      <div class="overflow-x-auto">
        <svg viewBox="0 0 800 300" class="h-auto w-full min-w-[600px]">
          <!-- Grid lines -->
          <line x1="40" y1="260" x2="760" y2="260" stroke="currentColor" stroke-opacity="0.15" />
          <line x1="40" y1="40" x2="40" y2="260" stroke="currentColor" stroke-opacity="0.15" />

          {#each chartPaths as path}
            <polyline
              points={path.points}
              fill="none"
              stroke={path.color}
              stroke-width="2"
              stroke-linejoin="round"
            />
          {/each}
        </svg>
        <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-4">
          {#each chartPaths as path}
            <div class="flex items-center gap-1.5 text-xs">
              <span
                class="inline-block h-2.5 w-2.5 rounded-full"
                style="background:{path.color}"
              ></span>
              <span>{path.handle}</span>
            </div>
          {/each}
        </div>
      </div>
    </section>
  {/if}

  <!-- Scoreboard Table -->
  {#if scoreboard.entries.length === 0}
    <div class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-6 py-12 text-center">
      <p class="text-muted-foreground">No participants yet.</p>
    </div>
  {:else if scoreboard.scoringMode === "icpc"}
    <!-- ICPC Table -->
    <div class="overflow-x-auto rounded-2xl border border-border">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-border bg-[color:var(--color-panel-strong)]">
            <th class="px-3 py-2.5 text-left font-medium">#</th>
            <th class="px-3 py-2.5 text-left font-medium">User</th>
            <th class="px-3 py-2.5 text-right font-medium">Solved</th>
            <th class="px-3 py-2.5 text-right font-medium">Penalty</th>
            {#each scoreboard.problems as prob}
              <th class="px-3 py-2.5 text-center font-medium">
                <a href="/problems/{prob.slug}" class="hover:underline">
                  {String.fromCharCode(65 + prob.ordinal)}
                </a>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each scoreboard.entries as entry, idx}
            <tr class="border-b border-border last:border-b-0 {idx % 2 === 0 ? 'bg-[color:var(--color-panel)]' : 'bg-[color:var(--color-panel-strong)]/30'}">
              <td class="px-3 py-2 font-medium">{entry.rank}</td>
              <td class="px-3 py-2">
                <span class="font-medium">{entry.handle}</span>
                {#if entry.isFirstBlood.some(Boolean)}
                  <span class="ml-1" title="First Blood">&#9733;</span>
                {/if}
              </td>
              <td class="px-3 py-2 text-right font-semibold">{entry.totalScore}</td>
              <td class="px-3 py-2 text-right text-muted-foreground">{entry.totalPenalty}</td>
              {#each entry.problems as ps, pi}
                <td class="px-3 py-2 text-center {icpcCellClass(ps)}">
                  <span>
                    {formatIcpcCell(ps)}
                    {#if entry.isFirstBlood[pi]}
                      <span class="ml-0.5 text-amber-500" title="First Blood">&#9733;</span>
                    {/if}
                  </span>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <!-- IOI Table -->
    <div class="overflow-x-auto rounded-2xl border border-border">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-border bg-[color:var(--color-panel-strong)]">
            <th class="px-3 py-2.5 text-left font-medium">#</th>
            <th class="px-3 py-2.5 text-left font-medium">User</th>
            <th class="px-3 py-2.5 text-right font-medium">Total</th>
            {#each scoreboard.problems as prob}
              <th class="px-3 py-2.5 text-center font-medium">
                <a href="/problems/{prob.slug}" class="hover:underline">
                  {String.fromCharCode(65 + prob.ordinal)}
                </a>
                <span class="block text-xs font-normal text-muted-foreground">{prob.points}</span>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each scoreboard.entries as entry, idx}
            <tr class="border-b border-border last:border-b-0 {idx % 2 === 0 ? 'bg-[color:var(--color-panel)]' : 'bg-[color:var(--color-panel-strong)]/30'}">
              <td class="px-3 py-2 font-medium">{entry.rank}</td>
              <td class="px-3 py-2">
                <span class="font-medium">{entry.handle}</span>
                {#if entry.isFirstBlood.some(Boolean)}
                  <span class="ml-1 text-amber-500" title="First Blood">&#9733;</span>
                {/if}
              </td>
              <td class="px-3 py-2 text-right font-semibold">{entry.totalScore}</td>
              {#each entry.problems as ps, pi}
                {@const prob = scoreboard.problems[pi]}
                <td class="px-3 py-2 text-center">
                  {#if ps.isPending}
                    <span class="inline-block rounded px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">?</span>
                  {:else}
                    <span class="inline-block rounded px-2 py-0.5 text-xs font-medium {ioiScoreColor(ps.score, prob?.points ?? 100)}">
                      {ps.score}
                      {#if entry.isFirstBlood[pi]}
                        <span class="text-amber-500" title="First Blood">&#9733;</span>
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
  {/if}
</div>
