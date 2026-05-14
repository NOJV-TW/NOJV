<script lang="ts" module>
  export type Difficulty = "Easy" | "Medium" | "Hard";

  const LEVELS: Record<Difficulty, number> = { Easy: 1, Medium: 2, Hard: 3 };
  const HEIGHTS = [6, 9, 12] as const;
  const COLORS = ["var(--chart-5)", "var(--chart-4)", "var(--destructive)"] as const;
</script>

<script lang="ts">
  interface Props {
    level: Difficulty;
  }

  let { level }: Props = $props();

  const n = $derived(LEVELS[level] ?? 1);
</script>

<span class="inline-flex items-center gap-0.5">
  {#each [1, 2, 3] as i (i)}
    <span
      class="block w-1 rounded-sm"
      style="height: {HEIGHTS[i - 1]}px; background: {i <= n ? COLORS[n - 1] : 'var(--border-strong)'}; opacity: {i <= n ? 1 : 0.35};"
    ></span>
  {/each}
  <span class="ml-1.5 text-micro font-mono uppercase tracking-wider text-muted-foreground">
    {level}
  </span>
</span>
