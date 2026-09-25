<script lang="ts" module>
  const chartColors = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ];

  export interface ScoreProgressSeries {
    userId: string;
    username: string;
    points: { time: number; score: number }[];
  }

  function buildChartPaths(
    series: { username: string; points: { time: number; score: number }[] }[],
    width: number,
    height: number,
    padding: number,
    durationSeconds = 0,
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
    maxTime = Math.max(maxTime, durationSeconds, 1);
    if (maxScore === 0) maxScore = 1;

    const plotW = width - padding * 2;
    const plotH = height - padding * 2;

    return series.map((s, i) => {
      const pathPoints: string[] = [];
      for (const [index, pt] of s.points.entries()) {
        const x = padding + (pt.time / maxTime) * plotW;
        const y = height - padding - (pt.score / maxScore) * plotH;
        if (index === 0) {
          pathPoints.push(`${String(x)},${String(y)}`);
          continue;
        }
        const previous = s.points[index - 1]!;
        const previousY = height - padding - (previous.score / maxScore) * plotH;
        pathPoints.push(`${String(x)},${String(previousY)}`, `${String(x)},${String(y)}`);
      }
      const lastPoint = s.points.at(-1) ?? { time: 0, score: 0 };
      if (lastPoint.time < maxTime) {
        const lastY = height - padding - (lastPoint.score / maxScore) * plotH;
        pathPoints.push(`${String(padding + plotW)},${String(lastY)}`);
      }
      return {
        color: chartColors[i % chartColors.length] ?? "var(--chart-1)",
        username: s.username,
        points: pathPoints.join(" "),
      };
    });
  }

  function buildChartTicks(
    series: { points: { time: number; score: number }[] }[],
    width: number,
    height: number,
    padding: number,
    count: number,
    durationSeconds = 0,
  ): {
    x: { label: string; position: number }[];
    y: { label: string; position: number }[];
  } {
    let maxTime = 0;
    let maxScore = 0;
    for (const item of series) {
      for (const point of item.points) {
        maxTime = Math.max(maxTime, point.time);
        maxScore = Math.max(maxScore, point.score);
      }
    }
    maxTime = Math.max(maxTime, durationSeconds, 1);
    maxScore = Math.max(maxScore, 1);
    const plotW = width - padding * 2;
    const plotH = height - padding * 2;
    const yCount = Math.min(count, Math.max(1, Math.floor(maxScore)));
    const formatTime = (seconds: number) => {
      return String(Math.round(seconds / 60));
    };

    return {
      x: Array.from({ length: count + 1 }, (_, index) => {
        const value = (maxTime * index) / count;
        return { label: formatTime(value), position: padding + (value / maxTime) * plotW };
      }),
      y: Array.from({ length: yCount + 1 }, (_, index) => {
        const value = (maxScore * index) / yCount;
        return {
          label: String(Math.round(value)),
          position: height - padding - (value / maxScore) * plotH,
        };
      }),
    };
  }
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import * as Select from "$lib/components/primitives/ui/select";
  import GlassPanel from "$lib/components/primitives/visual/GlassPanel.svelte";

  let {
    series,
    durationSeconds,
    selectedUserId = $bindable(null),
  }: {
    series: ScoreProgressSeries[];
    durationSeconds: number;
    selectedUserId?: string | null;
  } = $props();
  const selectedChartSeries = $derived(
    series.find((s) => s.userId === selectedUserId) ?? series[0] ?? null,
  );

  $effect(() => {
    const firstUserId = series[0]?.userId ?? null;
    if (selectedUserId === null || !series.some((s) => s.userId === selectedUserId)) {
      untrack(() => (selectedUserId = firstUserId));
    }
  });

  const chartSeries = $derived(selectedChartSeries ? [selectedChartSeries] : []);
  const chartPaths = $derived(buildChartPaths(chartSeries, 800, 300, 40, durationSeconds));
  const chartTicks = $derived(buildChartTicks(chartSeries, 800, 300, 40, 4, durationSeconds));
</script>

<GlassPanel class="p-6">
  <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
    <h3
      id="scoreboard-chart-heading"
      class="font-mono text-micro uppercase tracking-wider text-muted-foreground"
    >
      {m.contestScoreboard_chartHeading({ username: selectedChartSeries?.username ?? "—" })}
    </h3>
    <div class="flex items-center gap-2 text-caption text-muted-foreground">
      <span>{m.contestScoreboard_chartUserLabel()}</span>
      <Select.Root
        type="single"
        value={selectedUserId ?? ""}
        onValueChange={(value) => (selectedUserId = value)}
      >
        <Select.Trigger size="sm" aria-label={m.contestScoreboard_chartUserLabel()}>
          {selectedChartSeries?.username ?? ""}
        </Select.Trigger>
        <Select.Content>
          {#each series as item (item.userId)}
            <Select.Item value={item.userId} label={item.username}>
              {item.username}
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  </div>
  <div class="overflow-x-auto rounded-sm" style="background: var(--panel-strong);">
    <svg
      viewBox="0 0 800 300"
      class="h-auto w-full min-w-[600px]"
      role="img"
      aria-labelledby="scoreboard-chart-heading"
    >
      <line x1="40" y1="260" x2="760" y2="260" stroke="currentColor" stroke-opacity="0.15" />
      <line x1="40" y1="40" x2="40" y2="260" stroke="currentColor" stroke-opacity="0.15" />
      {#each chartTicks.y as tick}
        <line
          x1="40"
          y1={tick.position}
          x2="760"
          y2={tick.position}
          stroke="currentColor"
          stroke-opacity="0.08"
        />
        <text
          x="34"
          y={tick.position + 4}
          text-anchor="end"
          class="fill-muted-foreground font-mono text-[10px]">{tick.label}</text
        >
      {/each}
      {#each chartTicks.x as tick}
        <line
          x1={tick.position}
          y1="260"
          x2={tick.position}
          y2="264"
          stroke="currentColor"
          stroke-opacity="0.2"
        />
        <text
          x={tick.position}
          y="280"
          text-anchor="middle"
          class="fill-muted-foreground font-mono text-[10px]">{tick.label}</text
        >
      {/each}
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
  </div>
</GlassPanel>
