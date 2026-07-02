<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils/css.js";
  import GlassPanel from "./GlassPanel.svelte";

  interface Props {
    label: string;
    value: Snippet;
    class?: string;
  }

  let { label, value, class: className }: Props = $props();
</script>

<GlassPanel class={cn("flex min-w-[150px] flex-1 flex-col justify-between p-4", className)}>
  <div class="text-micro font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
  <div class="mt-2 text-title-sm font-semibold tabular-nums">{@render value()}</div>
</GlassPanel>
