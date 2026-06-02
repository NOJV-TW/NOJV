<script lang="ts" module>
  export type Difficulty = "easy" | "medium" | "hard";
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    level: Difficulty;
  }

  let { level }: Props = $props();

  const RANK: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };
  const HEIGHTS = [6, 9, 12] as const;
  const COLORS = ["var(--chart-5)", "var(--chart-4)", "var(--destructive)"] as const;
  const LABELS: Record<Difficulty, () => string> = {
    easy: m.admin_difficultyEasy,
    medium: m.admin_difficultyMedium,
    hard: m.admin_difficultyHard
  };

  const n = $derived(RANK[level] ?? 1);
</script>

<span class="inline-flex items-center gap-0.5">
  {#each [1, 2, 3] as i (i)}
    <span
      class="block w-1 rounded-sm"
      style="height: {HEIGHTS[i - 1]}px; background: {i <= n
        ? COLORS[n - 1]
        : 'var(--border-strong)'}; opacity: {i <= n ? 1 : 0.35};"
    ></span>
  {/each}
  <span class="ml-1.5 text-micro font-mono uppercase tracking-wider text-muted-foreground">
    {LABELS[level]?.() ?? level}
  </span>
</span>
