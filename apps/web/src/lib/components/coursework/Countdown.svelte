<script lang="ts">
  import { onMount } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { diffMs, fmtCountdown } from "$lib/utils/datetime.js";

  interface Props {
    iso: string;
    isCompact?: boolean;
  }

  let { iso, isCompact = false }: Props = $props();

  let now = $state(Date.now());
  onMount(() => {
    const id = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(id);
  });

  const c = $derived(fmtCountdown(diffMs(iso, new Date(now))));

  function pad(n: number): string {
    return n < 10 ? `0${String(n)}` : String(n);
  }
</script>

{#if isCompact}
  <span class="font-mono tabular-nums">
    {#if c.past}
      {m.countdown_past()}
    {:else if c.d > 0}
      {c.d}d {pad(c.h)}h
    {:else}
      {pad(c.h)}:{pad(c.m)}:{pad(c.s)}
    {/if}
  </span>
{:else}
  <div class="inline-flex items-baseline gap-1 font-mono tabular-nums">
    {#if c.past}
      <span class="text-muted-foreground">{m.countdown_past()}</span>
    {:else}
      {#if c.d > 0}
        <span class="text-title font-bold">{c.d}</span>
        <span class="text-caption text-muted-foreground mr-1">d</span>
      {/if}
      <span class="text-title font-bold">{pad(c.h)}</span>
      <span class="text-caption text-muted-foreground">h</span>
      <span class="text-title font-bold">{pad(c.m)}</span>
      <span class="text-caption text-muted-foreground">m</span>
      {#if c.d === 0}
        <span class="text-title font-bold">{pad(c.s)}</span>
        <span class="text-caption text-muted-foreground">s</span>
      {/if}
    {/if}
  </div>
{/if}
