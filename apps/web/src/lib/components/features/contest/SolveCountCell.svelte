<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    firstAcTime: number | null;
    attempts: number;
    isPending: boolean;
    isFirstBlood: boolean;
  }

  let { firstAcTime, attempts, isPending, isFirstBlood }: Props = $props();

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
    class="relative flex min-h-[72px] w-full flex-col items-center justify-center gap-0.5 px-2 py-1"
    style="background: color-mix(in oklab, var(--success) 18%, transparent);"
  >
    {#if isFirstBlood}
      <span
        class="absolute -top-1 -right-1 inline-grid place-items-center size-3.5 rounded-full text-[8px] font-bold"
        style="background: var(--chart-4); color: white;"
        title={m.contestDetail_firstBlood()}
      >
        ★
      </span>
    {/if}
    <span
      class="font-mono text-caption font-semibold tabular-nums"
      style="color: color-mix(in oklab, var(--success) 50%, var(--foreground));"
    >
      {fmtTime(firstAcTime)}
    </span>
    <span
      class="font-mono text-micro tabular-nums"
      style="color: color-mix(in oklab, var(--success) 50%, var(--foreground));"
    >
      {fmtAttempts(attempts)}
    </span>
  </div>
{:else if isPending}
  <div
    class="flex min-h-[72px] w-full flex-col items-center justify-center gap-0.5 px-2 py-1"
    style="background: color-mix(in oklab, var(--info) 14%, transparent);"
  >
    <span
      class="font-mono text-caption font-semibold"
      style="color: color-mix(in oklab, var(--info) 50%, var(--foreground));">?</span
    >
    <span
      class="font-mono text-micro"
      style="color: color-mix(in oklab, var(--info) 50%, var(--foreground));"
      >{m.scoreboard_pendingShort()}</span
    >
  </div>
{:else if attempts > 0}
  <div
    class="flex min-h-[72px] w-full flex-col items-center justify-center gap-0.5 px-2 py-1"
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
