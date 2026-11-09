<script lang="ts">
  import { Button } from "#lib/components/primitives/ui/button/index.js";
  import { m } from "#lib/paraglide/messages.js";

  let {
    visibleCount,
    totalCount,
    context,
  }: {
    visibleCount: number;
    totalCount: number;
    context?: { type: "assignment" | "exam" | "contest"; id: string };
  } = $props();
</script>

<div class="flex w-full min-w-0 flex-wrap items-center justify-end gap-3">
  {#if context}
    <Button
      variant="outline"
      size="sm"
      href={`/api/submissions/export?${new URLSearchParams({ context: context.type, id: context.id, format: "csv" })}`}
      download
    >
      {m.submissions_exportCsv()}
    </Button>
    <Button
      variant="outline"
      size="sm"
      href={`/api/submissions/export?${new URLSearchParams({ context: context.type, id: context.id, format: "zip" })}`}
      download
    >
      {m.submissions_exportZip()}
    </Button>
  {/if}
  <span class="whitespace-nowrap text-caption text-muted-foreground">
    {m.liveSubmissions_filterCount({ visible: visibleCount, total: totalCount })}
  </span>
</div>
