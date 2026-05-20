<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    /** First AC time in seconds since contest start. `null` when not solved. */
    firstAcTime: number | null;
    /** Best score on the problem. Acts as `points` when AC. */
    score: number;
    attempts: number;
    isPending: boolean;
  }

  let { firstAcTime, score, attempts, isPending }: Props = $props();

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
    class="inline-flex flex-col items-center gap-0.5 rounded-md px-2 py-1.5 min-w-[64px]"
    style="background: color-mix(in oklab, var(--success) 18%, transparent);"
  >
    <span
      class="font-mono text-caption font-semibold tabular-nums"
      style="color: oklch(0.4 0.13 160);"
    >
      +{score}
    </span>
    <span
      class="font-mono text-micro tabular-nums"
      style="color: oklch(0.45 0.13 160);"
    >
      {fmtTime(firstAcTime)}
    </span>
  </div>
{:else if isPending}
  <div
    class="inline-flex flex-col items-center gap-0.5 rounded-md px-2 py-1.5 min-w-[64px]"
    style="background: color-mix(in oklab, var(--info) 14%, transparent);"
  >
    <span class="font-mono text-caption font-semibold" style="color: var(--info);">?</span>
    <span class="font-mono text-micro" style="color: var(--info);">{m.scoreboard_pending()}</span>
  </div>
{:else if attempts > 0}
  <div
    class="inline-flex flex-col items-center gap-0.5 rounded-md px-2 py-1.5 min-w-[64px]"
    style="background: color-mix(in oklab, var(--destructive) 14%, transparent);"
  >
    <span class="font-mono text-caption font-semibold" style="color: oklch(0.5 0.18 27);">
      −{attempts}
    </span>
    <span class="font-mono text-micro" style="color: oklch(0.55 0.18 27);">{m.scoreboard_try()}</span>
  </div>
{:else}
  <span class="text-muted-foreground font-mono opacity-40">·</span>
{/if}
