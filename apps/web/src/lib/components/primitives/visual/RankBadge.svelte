<script lang="ts">
  interface Props {
    rank: number;
  }

  let { rank }: Props = $props();

  const bg = $derived(
    rank === 1
      ? "var(--rank-gold)"
      : rank === 2
        ? "var(--rank-silver)"
        : rank === 3
          ? "var(--rank-bronze)"
          : "var(--muted)",
  );
</script>

<span
  class="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-md font-mono font-bold tabular-nums {rank <=
  3
    ? 'text-primary-foreground'
    : 'text-muted-foreground'}"
  style="background: {bg};"
>
  {rank}
</span>
