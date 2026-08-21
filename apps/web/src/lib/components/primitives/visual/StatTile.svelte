<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils/css.js";
  import GlassPanel from "./GlassPanel.svelte";

  interface Props {
    label: string;
    value: Snippet;
    embedded?: boolean;
    class?: string;
  }

  let { label, value, embedded = false, class: className }: Props = $props();
</script>

{#if embedded}
  <div class={cn("min-w-[150px] flex-1", className)}>
    <div class="eyebrow text-muted-foreground">{label}</div>
    <div class="mt-2 text-title-sm font-semibold tabular-nums">{@render value()}</div>
  </div>
{:else}
  <GlassPanel class={cn("flex min-w-[150px] flex-1 flex-col justify-between p-4", className)}>
    <div class="eyebrow text-muted-foreground">{label}</div>
    <div class="mt-2 text-title-sm font-semibold tabular-nums">{@render value()}</div>
  </GlassPanel>
{/if}
