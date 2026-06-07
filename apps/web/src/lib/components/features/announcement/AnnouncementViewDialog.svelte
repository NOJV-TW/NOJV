<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import MarkdownRenderer from "$lib/components/primitives/layout/MarkdownRenderer.svelte";
  import { formatDateTimeCompact, formatRelativeFromNow } from "$lib/utils/datetime";

  interface AnnouncementView {
    title: string;
    content: string;
    authorName: string;
    createdAt: string;
    pinned: boolean;
    expiresAt: string | null;
  }

  interface Props {
    open: boolean;
    announcement: AnnouncementView | null;
  }

  let { open = $bindable(false), announcement }: Props = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Content showCloseButton class="max-w-xl">
    {#if announcement}
      <Dialog.Header>
        <div class="flex flex-wrap items-center gap-2">
          <Dialog.Title class="text-title">{announcement.title}</Dialog.Title>
          {#if announcement.pinned}
            <Badge variant="warning" size="sm">
              {m.admin_announcementsPinned()}
            </Badge>
          {/if}
        </div>
        <Dialog.Description>
          {announcement.authorName} ·
          {formatRelativeFromNow(announcement.createdAt)} ·
          {formatDateTimeCompact(announcement.createdAt)}
        </Dialog.Description>
      </Dialog.Header>

      <div class="max-h-[60vh] overflow-y-auto text-body text-foreground">
        <MarkdownRenderer content={announcement.content} />
      </div>

      {#if announcement.expiresAt}
        <p class="text-caption text-muted-foreground">
          {m.admin_announcement_expired_at({
            date: formatDateTimeCompact(announcement.expiresAt),
          })}
        </p>
      {/if}
    {/if}
  </Dialog.Content>
</Dialog.Root>
