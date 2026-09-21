<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  let {
    visibleCount,
    totalCount,
  }: {
    visibleCount: number;
    totalCount: number;
  } = $props();
</script>

<div class="flex w-full min-w-0 flex-wrap items-center justify-end gap-3">
  <span class="whitespace-nowrap text-caption text-muted-foreground">
    {m.liveSubmissions_filterCount({ visible: visibleCount, total: totalCount })}
  </span>
</div>
