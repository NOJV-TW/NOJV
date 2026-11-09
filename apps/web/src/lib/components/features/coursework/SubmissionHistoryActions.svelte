<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Download from "@lucide/svelte/icons/download";
  import { Button, buttonVariants } from "#lib/components/primitives/ui/button/index.js";
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

  function exportUrl(format: "all" | "csv" | "zip") {
    return `/api/submissions/export?${new URLSearchParams({ context: context!.type, id: context!.id, format })}`;
  }
</script>

<div class="flex w-full min-w-0 flex-wrap items-center justify-end gap-3">
  {#if context}
    <div class="inline-flex">
      <Button
        variant="outline"
        size="sm"
        class="rounded-r-none"
        href={exportUrl("all")}
        title={m.submissions_exportBoth()}
        download
      >
        <Download aria-hidden="true" />
        {m.submissions_export()}
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class={buttonVariants({
            variant: "outline",
            size: "sm",
            class: "rounded-l-none border-l-0 px-2",
          })}
          aria-label={m.submissions_exportOptions()}
        >
          <ChevronDown aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            class="z-50 min-w-40 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-modal"
          >
            {#each ["csv", "zip"] as format}
              <DropdownMenu.Item>
                {#snippet child({ props })}
                  <a
                    {...props}
                    href={exportUrl(format as "csv" | "zip")}
                    download
                    class="flex cursor-pointer items-center rounded-md px-3 py-2 text-body-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  >
                    {format === "csv" ? m.submissions_exportCsv() : m.submissions_exportZip()}
                  </a>
                {/snippet}
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  {/if}
  <span class="whitespace-nowrap text-caption text-muted-foreground">
    {m.liveSubmissions_filterCount({ visible: visibleCount, total: totalCount })}
  </span>
</div>
