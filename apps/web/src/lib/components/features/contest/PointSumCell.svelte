<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    firstAcTime: number | null;
    score: number;
    attempts: number;
    isPending: boolean;
  }

  let { firstAcTime, score, attempts, isPending }: Props = $props();

  function fmtTime(sec: number): string {
    return String(Math.floor(sec / 60));
  }

  function fmtAttempts(count: number): string {
    return count === 1
      ? m.scoreboard_attemptsOne({ count })
      : m.scoreboard_attemptsMany({ count });
  }
</script>

{#if firstAcTime !== null}
  <div
    class="flex min-h-[72px] w-full flex-col items-center justify-center gap-0.5 px-2 py-1.5"
    style="background: color-mix(in oklab, var(--success) 18%, transparent);"
  >
    <span
      class="font-mono text-caption font-semibold tabular-nums"
      style="color: color-mix(in oklab, var(--success) 50%, var(--foreground));"
    >
      {score}
    </span>
    <span
      class="font-mono text-micro tabular-nums"
      style="color: color-mix(in oklab, var(--success) 50%, var(--foreground));"
    >
      {fmtTime(firstAcTime)} · {fmtAttempts(attempts)}
    </span>
  </div>
{:else if isPending}
  <div
    class="flex min-h-[72px] w-full flex-col items-center justify-center gap-0.5 px-2 py-1.5"
    style="background: color-mix(in oklab, var(--info) 14%, transparent);"
  >
    <span
      class="font-mono text-caption font-semibold"
      style="color: color-mix(in oklab, var(--info) 50%, var(--foreground));">?</span
    >
    <span
      class="font-mono text-micro"
      style="color: color-mix(in oklab, var(--info) 50%, var(--foreground));"
      >{m.scoreboard_pending()}</span
    >
  </div>
{:else if attempts > 0}
  <div
    class="flex min-h-[72px] w-full flex-col items-center justify-center gap-0.5 px-2 py-1.5"
    style="background: color-mix(in oklab, var(--destructive) 14%, transparent);"
  >
    <span
      class="font-mono text-caption font-semibold tabular-nums"
      style="color: color-mix(in oklab, var(--destructive) 50%, var(--foreground));"
      >{fmtAttempts(attempts)}</span
    >
  </div>
{:else}
  <div
    class="flex min-h-[72px] w-full items-center justify-center text-muted-foreground font-mono opacity-40"
  >
    ·
  </div>
{/if}
