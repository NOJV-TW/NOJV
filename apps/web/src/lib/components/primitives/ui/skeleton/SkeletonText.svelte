<script lang="ts" module>
  import { cn } from "$lib/utils/css.js";

  export type SkeletonTextProps = {
    lines?: number;
    lastLineWidth?: string;
    class?: string;
  };
</script>

<script lang="ts">
  import Skeleton from "./skeleton.svelte";

  let { lines = 3, lastLineWidth = "60%", class: className }: SkeletonTextProps = $props();

  const count = $derived(Math.max(1, lines));
</script>

<div data-slot="skeleton-text" class={cn("flex flex-col gap-2", className)} aria-hidden="true">
  {#each Array(count) as _, i (i)}
    {#if i === count - 1 && count > 1}
      <Skeleton variant="text" class="h-4" style={`width: ${lastLineWidth};`} />
    {:else}
      <Skeleton variant="text" class="h-4 w-full" />
    {/if}
  {/each}
</div>
