<script lang="ts">
  import { notifications, type NotificationItem } from "$lib/stores/notifications.svelte";
  import { cn } from "$lib/utils.js";

  let { item }: { item: NotificationItem } = $props();

  let isUnread = $derived(item.readAt === null);

  // TODO i18n Task 19: replace with m.notification_<type>(item.params as any).
  // Placeholder English strings here keep the component functional until the
  // paraglide keys land.
  function renderText(n: NotificationItem): string {
    const p = n.params ?? {};
    switch (n.type) {
      case "assignment_due_soon":
        return `Assignment "${String((p as Record<string, unknown>).assignmentName ?? "")}" is due soon.`;
      case "exam_starting_soon":
        return `Exam "${String((p as Record<string, unknown>).examName ?? "")}" is starting soon.`;
      case "contest_starting_soon":
        return `Contest "${String((p as Record<string, unknown>).contestName ?? "")}" is starting soon.`;
      case "course_enrolled":
        return `You were enrolled in ${String((p as Record<string, unknown>).courseName ?? "")}.`;
      case "announcement_published":
        return `New announcement: ${String((p as Record<string, unknown>).title ?? "")}.`;
      case "role_changed":
        return `Your platform role was changed to ${String((p as Record<string, unknown>).newRole ?? "")}.`;
      case "clarification_answered":
        return `Your clarification was answered.`;
      default:
        return n.type;
    }
  }

  function renderRelative(iso: string): string {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  function handleClick() {
    // Fire-and-forget; does not block navigation.
    void notifications.markOne(item.id);
  }

  let text = $derived(renderText(item));
  let relative = $derived(renderRelative(item.createdAt));
  let commonClass = $derived(
    cn(
      "flex w-full items-start gap-3 border-l-2 px-4 py-3 text-left transition-colors duration-fast ease-out-soft hover:bg-accent",
      isUnread ? "border-primary" : "border-transparent opacity-60"
    )
  );
</script>

{#if item.linkUrl}
  <a class={commonClass} href={item.linkUrl} onclick={handleClick}>
    <div class="flex-1 space-y-1">
      <p class="text-body-sm leading-snug">{text}</p>
      <p class="text-caption text-muted-foreground">{relative}</p>
    </div>
    {#if isUnread}
      <span
        class="mt-1.5 inline-block size-2 flex-none rounded-full bg-primary"
        aria-hidden="true"
      ></span>
    {/if}
  </a>
{:else}
  <button class={commonClass} onclick={handleClick} type="button">
    <div class="flex-1 space-y-1">
      <p class="text-body-sm leading-snug">{text}</p>
      <p class="text-caption text-muted-foreground">{relative}</p>
    </div>
    {#if isUnread}
      <span
        class="mt-1.5 inline-block size-2 flex-none rounded-full bg-primary"
        aria-hidden="true"
      ></span>
    {/if}
  </button>
{/if}
