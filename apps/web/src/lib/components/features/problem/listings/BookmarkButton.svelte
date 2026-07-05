<script lang="ts">
  import { Bookmark } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { fetchWithCsrf } from "$lib/services/http";
  import { toasts } from "$lib/stores/toast";
  import { cn } from "$lib/utils/css.js";

  interface Props {
    problemId: string;
    bookmarked: boolean;
    size?: "sm" | "md";
    class?: string;
  }

  let { problemId, bookmarked, size = "sm", class: className }: Props = $props();

  let override = $state<boolean | null>(null);
  let active = $derived(override ?? bookmarked);
  let pending = $state(false);

  async function toggle(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    pending = true;
    const previous = active;
    override = !previous;
    try {
      const res = await fetchWithCsrf(`/api/problems/${problemId}/bookmark`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("toggle failed");
      const body = (await res.json()) as { bookmarked: boolean };
      override = body.bookmarked;
      toasts.success(
        body.bookmarked ? m.problems_bookmarkAdded() : m.problems_bookmarkRemoved(),
      );
    } catch {
      override = previous;
      toasts.error(m.problems_bookmarkError());
    } finally {
      pending = false;
    }
  }
</script>

<button
  type="button"
  onclick={toggle}
  disabled={pending}
  aria-pressed={active}
  aria-label={active ? m.problems_bookmarkRemove() : m.problems_bookmarkAdd()}
  title={active ? m.problems_bookmarkRemove() : m.problems_bookmarkAdd()}
  class={cn(
    "inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[color,background-color,transform] duration-fast ease-out-soft hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
    size === "md" ? "size-9" : "size-8",
    active && "text-primary hover:text-primary",
    className,
  )}
>
  <Bookmark
    class={cn(size === "md" ? "size-5" : "size-4", active && "fill-current")}
    aria-hidden="true"
  />
</button>
