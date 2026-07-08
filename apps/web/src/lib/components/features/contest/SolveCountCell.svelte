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
    const totalMin = Math.floor(sec / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) {
      return `${String(h)}:${m < 10 ? `0${String(m)}` : String(m)}`;
    }
    return `${m < 10 ? `0${String(m)}` : String(m)}m`;
  }
</script>

{#if firstAcTime !== null}
  <div
    class="relative inline-flex flex-col items-center gap-0.5 rounded-md px-2 py-1 min-w-[60px]"
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
    {#if attempts > 0}
      <span
        class="font-mono text-micro tabular-nums"
        style="color: color-mix(in oklab, var(--success) 50%, var(--foreground));"
      >
        +{attempts}
      </span>
    {/if}
  </div>
{:else if isPending}
  <div
    class="inline-flex flex-col items-center gap-0.5 rounded-md px-2 py-1 min-w-[60px]"
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
    class="inline-flex flex-col items-center gap-0.5 rounded-md px-2 py-1 min-w-[60px]"
    style="background: color-mix(in oklab, var(--destructive) 14%, transparent);"
  >
    <span
      class="font-mono text-caption font-semibold"
      style="color: color-mix(in oklab, var(--destructive) 50%, var(--foreground));"
    >
      −{attempts}
    </span>
    <span
      class="font-mono text-micro"
      style="color: color-mix(in oklab, var(--destructive) 50%, var(--foreground));"
      >{m.scoreboard_wa()}</span
    >
  </div>
{:else}
  <span class="text-muted-foreground font-mono opacity-40">·</span>
{/if}
