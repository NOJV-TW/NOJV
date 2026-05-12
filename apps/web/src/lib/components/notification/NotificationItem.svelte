<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { getLocale } from "$lib/paraglide/runtime.js";
  import { notifications, type NotificationItem } from "$lib/stores/notifications.svelte";
  import { cn } from "$lib/css.js";

  let { item }: { item: NotificationItem } = $props();

  let isUnread = $derived(item.readAt === null);

  function renderText(n: NotificationItem): string {
    const p = (n.params ?? {}) as Record<string, string>;
    switch (n.type) {
      case "assignment_due_soon":
        return m.notification_assignment_due_soon({ title: p.title ?? "" });
      case "exam_starting_soon":
        return m.notification_exam_starting_soon({ title: p.title ?? "" });
      case "contest_starting_soon":
        return m.notification_contest_starting_soon({ title: p.title ?? "" });
      case "course_enrolled":
        return m.notification_course_enrolled({ courseName: p.courseName ?? "" });
      case "announcement_published": {
        const title = getLocale() === "zh-TW" ? (p.titleZhTw ?? p.titleEn) : (p.titleEn ?? p.titleZhTw);
        return m.notification_announcement_published({ title: title ?? "" });
      }
      case "role_changed":
        return m.notification_role_changed({ newRole: p.newRole ?? "" });
      case "clarification_answered":
        return m.notification_clarification_answered({ questionPreview: p.questionPreview ?? "" });
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
