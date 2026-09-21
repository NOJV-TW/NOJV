<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  let {
    search = $bindable(),
    visibleCount,
    totalCount,
  }: {
    search: string;
    visibleCount: number;
    totalCount: number;
  } = $props();
</script>

<div class="flex w-full min-w-0 flex-wrap items-center justify-end gap-3">
  <span class="whitespace-nowrap text-caption text-muted-foreground">
    {m.liveSubmissions_filterCount({ visible: visibleCount, total: totalCount })}
  </span>
  <input
    aria-label={m.liveSubmissions_searchPlaceholder()}
    class="h-9 w-full min-w-0 sm:w-56 rounded-md border border-border bg-background px-3 text-body-sm placeholder:text-muted-foreground lg:w-64"
    placeholder={m.liveSubmissions_searchPlaceholder()}
    type="search"
    bind:value={search}
  />
</div>
