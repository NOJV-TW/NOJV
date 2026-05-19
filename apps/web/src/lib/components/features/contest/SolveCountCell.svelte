<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    /** First AC time in seconds since contest start. `null` when not solved. */
    firstAcTime: number | null;
    /** Total wrong attempts before AC (or total wrong attempts when not solved). */
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
        style="background: #d4a054; color: white;"
        title="First Blood"
      >
        ★
      </span>
    {/if}
    <span
      class="font-mono text-caption font-semibold tabular-nums"
      style="color: oklch(0.4 0.13 160);"
    >
      {fmtTime(firstAcTime)}
    </span>
    {#if attempts > 0}
      <span
        class="font-mono text-[10px] tabular-nums opacity-70"
        style="color: oklch(0.45 0.13 160);"
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
    <span class="font-mono text-caption font-semibold" style="color: var(--info);">?</span>
    <span class="font-mono text-[10px]" style="color: var(--info);">{m.scoreboard_pendingShort()}</span>
  </div>
{:else if attempts > 0}
  <div
    class="inline-flex flex-col items-center gap-0.5 rounded-md px-2 py-1 min-w-[60px]"
    style="background: color-mix(in oklab, var(--destructive) 14%, transparent);"
  >
    <span class="font-mono text-caption font-semibold" style="color: oklch(0.5 0.18 27);">
      −{attempts}
    </span>
    <span class="font-mono text-[10px]" style="color: oklch(0.55 0.18 27);">{m.scoreboard_wa()}</span>
  </div>
{:else}
  <span class="text-muted-foreground font-mono opacity-40">·</span>
{/if}
