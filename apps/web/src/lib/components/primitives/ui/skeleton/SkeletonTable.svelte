<script lang="ts" module>
  import { cn } from "$lib/utils/css.js";

  export type SkeletonTableProps = {
    rows?: number;
    columns?: number;
    class?: string;
  };
</script>

<script lang="ts">
  import Skeleton from "./skeleton.svelte";

  let { rows = 5, columns = 4, class: className }: SkeletonTableProps = $props();

  const rowCount = $derived(Math.max(1, rows));
  const colCount = $derived(Math.max(1, columns));
  const gridStyle = $derived(
    `grid-template-columns: repeat(${String(colCount)}, minmax(0, 1fr));`,
  );
</script>

<div data-slot="skeleton-table" aria-hidden="true" class={cn("flex flex-col", className)}>
  <div class="grid gap-4 border-b border-border-subtle py-3" style={gridStyle}>
    {#each Array(colCount) as _, i (i)}
      <Skeleton variant="text" class="h-5 w-3/4" />
    {/each}
  </div>
  {#each Array(rowCount) as _, r (r)}
    <div
      class="grid gap-4 border-b border-border-subtle py-3 last:border-b-0"
      style={gridStyle}
    >
      {#each Array(colCount) as _, c (c)}
        <Skeleton variant="text" class="h-4 w-full" />
      {/each}
    </div>
  {/each}
</div>
