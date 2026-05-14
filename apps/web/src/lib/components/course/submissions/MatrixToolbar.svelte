<script lang="ts">
  import { Download, Search } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import type { MatrixViewLabels } from "./MatrixView.svelte";

  type SortKey = "totalDesc" | "handleAsc" | "nameAsc";

  interface Props {
    sortKey: SortKey;
    search: string;
    showRoleFilter: boolean;
    labels: MatrixViewLabels;
    onExport: () => void;
  }

  let {
    sortKey = $bindable(),
    search = $bindable(),
    showRoleFilter,
    labels,
    onExport
  }: Props = $props();
</script>

<div class="flex flex-wrap items-center gap-3 border-b border-border-subtle pb-4">
  {#if showRoleFilter && labels.filterAll && labels.filterStudents}
    <select
      class="h-9 min-w-[140px] rounded-md border border-border bg-[color:var(--color-panel)] px-3 text-body-sm text-foreground"
      disabled
      title={labels.roleFilterTooltip?.()}
    >
      <option value="all">{labels.filterAll()}</option>
      <option value="students">{labels.filterStudents()}</option>
    </select>
  {/if}

  <select
    bind:value={sortKey}
    class="h-9 min-w-[140px] rounded-md border border-border bg-[color:var(--color-panel)] px-3 text-body-sm text-foreground"
  >
    <option value="totalDesc">{labels.sortTotalDesc()}</option>
    <option value="handleAsc">{labels.sortHandleAsc()}</option>
    <option value="nameAsc">{labels.sortNameAsc()}</option>
  </select>

  <div class="relative max-w-[260px] flex-1">
    <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
      <Search class="size-4" aria-hidden="true" />
    </span>
    <input
      type="text"
      bind:value={search}
      placeholder={labels.searchPlaceholder()}
      class="h-9 w-full rounded-md border border-border bg-[color:var(--color-panel)] pl-9 pr-3 text-body-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    />
  </div>

  <span class="flex-1"></span>

  <Button variant="outline" size="sm" onclick={onExport}>
    <Download class="size-4" aria-hidden="true" />
    {labels.exportCsv()}
  </Button>
</div>
