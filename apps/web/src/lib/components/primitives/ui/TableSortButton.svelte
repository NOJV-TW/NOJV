<script lang="ts">
  import { ArrowDown, ArrowUp, ArrowUpDown } from "@lucide/svelte";
  import { cn } from "$lib/utils/css.js";
  import type { SortDirection } from "$lib/utils/table-sort";

  interface Props {
    label: string;
    direction: SortDirection | null;
    onclick: () => void;
    class?: string | undefined;
  }

  let { label, direction, onclick, class: className }: Props = $props();
</script>

<button
  type="button"
  class={cn(
    "-ml-1 inline-flex h-8 items-center gap-1.5 rounded-sm px-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    direction ? "text-primary hover:bg-primary/10" : "hover:bg-muted hover:text-foreground",
    className,
  )}
  {onclick}
>
  <span>{label}</span>
  {#if direction === "asc"}
    <ArrowUp aria-hidden="true" class="size-3.5 shrink-0" />
  {:else if direction === "desc"}
    <ArrowDown aria-hidden="true" class="size-3.5 shrink-0" />
  {:else}
    <ArrowUpDown aria-hidden="true" class="size-3.5 shrink-0 opacity-50" />
  {/if}
</button>
