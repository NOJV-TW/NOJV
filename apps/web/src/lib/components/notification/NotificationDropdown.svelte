<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { notifications } from "$lib/stores/notifications.svelte";
  import NotificationItem from "./NotificationItem.svelte";
</script>

<div class="flex w-80 flex-col overflow-hidden">
  <div class="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
    <p class="text-body-sm font-semibold">{m.notification_dropdown_title()}</p>
    <button
      class="text-caption text-primary transition-opacity duration-fast ease-out-soft hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
      disabled={notifications.unreadCount === 0}
      onclick={() => void notifications.markAll()}
      type="button"
    >
      {m.notification_dropdown_markAllRead()}
    </button>
  </div>

  {#if notifications.items.length === 0}
    <div class="px-4 py-8 text-center text-body-sm text-muted-foreground">
      {m.notification_dropdown_empty()}
    </div>
  {:else}
    <div class="max-h-96 overflow-y-auto">
      {#each notifications.items as item (item.id)}
        <NotificationItem {item} />
      {/each}
    </div>
  {/if}
</div>
