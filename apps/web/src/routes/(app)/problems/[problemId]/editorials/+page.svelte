<script lang="ts">
  import { BookOpen } from "@lucide/svelte";
  import { goto, invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import Section from "$lib/components/ui/Section.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import { toasts } from "$lib/stores/toast";

  let { data } = $props();

  let pendingDeleteId = $state<string | null>(null);
  let deleting = $state(false);

  const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));

  function snippet(content: string, max = 240): string {
    // Markdown source preview — strip the first run of fence markers /
    // hashes so the snippet is readable, then truncate. Heavy formatting
    // is not worth rendering here; the edit page shows full markdown.
    const stripped = content
      .replace(/```[\s\S]*?```/g, "")
      .replace(/[#*_`>]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return stripped.length > max ? `${stripped.slice(0, max).trimEnd()}…` : stripped;
  }

  function canManage(authorId: string): boolean {
    return data.actor.userId === authorId || data.actor.platformRole === "admin";
  }

  function gotoPage(p: number) {
    if (p < 1 || p > totalPages || p === data.page) return;
    const url = new URL(window.location.href);
    url.searchParams.set("page", String(p));
    goto(url.pathname + url.search, { replaceState: false, keepFocus: true });
  }

  async function confirmDelete() {
    if (!pendingDeleteId || deleting) return;
    deleting = true;
    try {
      const res = await fetch(`/api/editorials/${pendingDeleteId}`, {
        method: "DELETE",
        headers: { "X-Requested-With": "fetch" }
      });
      if (res.ok) {
        toasts.add({ type: "success", message: m.editorial_deletedToast() });
        pendingDeleteId = null;
        await invalidateAll();
      } else {
        toasts.add({ type: "error", message: m.editorial_deleteError() });
      }
    } catch {
      toasts.add({ type: "error", message: m.editorial_deleteError() });
    } finally {
      deleting = false;
    }
  }
</script>

<Section>
  {#snippet header()}
    <h1 class="font-display text-title-lg">{m.editorial_listTitle()}</h1>
    <p>
      {m.editorial_listSubtitle()} —
      <a href="/problems/{data.problem.id}" class="text-primary hover:underline">
        {data.problem.title}
      </a>
    </p>
  {/snippet}

  {#if data.editorials.length === 0}
    <EmptyState
      variant="minimal"
      icon={BookOpen}
      title={m.editorial_listEmpty()}
      description={m.editorial_listEmptyHint()}
    />
  {:else}
    <div class="grid gap-4">
      {#each data.editorials as editorial (editorial.id)}
        <article class="rounded-lg border border-border-subtle p-4">
          <header class="flex flex-wrap items-baseline justify-between gap-3">
            <div class="flex flex-wrap items-baseline gap-2 text-caption text-muted-foreground">
              <span class="font-medium text-foreground">
                {editorial.author.name ?? editorial.author.username ?? m.editorial_unknownAuthor()}
              </span>
              <span class="rounded-full bg-muted px-2 py-0.5 text-micro font-medium">
                {editorial.language}
              </span>
              <span class="tabular-nums">
                {new Date(editorial.createdAt).toLocaleDateString()}
              </span>
            </div>
            {#if canManage(editorial.authorId)}
              <div class="flex shrink-0 items-center gap-2">
                <a
                  href="/editorials/{editorial.id}/edit"
                  class="rounded-md border border-border px-3 py-1 text-caption font-medium transition-[transform,box-shadow,background-color,border-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent"
                >
                  {m.editorial_edit()}
                </a>
                <button
                  class="rounded-md border border-border px-3 py-1 text-caption font-medium text-destructive transition-[transform,box-shadow,background-color,border-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:border-destructive/40 hover:bg-destructive/10"
                  type="button"
                  onclick={() => (pendingDeleteId = editorial.id)}
                >
                  {m.editorial_delete()}
                </button>
              </div>
            {/if}
          </header>
          <p class="mt-3 whitespace-pre-wrap text-body-sm leading-6 text-muted-foreground">
            {snippet(editorial.content)}
          </p>
        </article>
      {/each}
    </div>

    {#if totalPages > 1}
      <nav class="mt-6 flex items-center justify-center gap-2" aria-label="Pagination">
        <button
          class="rounded-md border border-border px-3 py-1 text-caption font-medium transition-[background-color,border-color] duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={data.page <= 1}
          onclick={() => gotoPage(data.page - 1)}
        >
          {m.editorial_pagePrev()}
        </button>
        <span class="text-caption text-muted-foreground tabular-nums">
          {data.page} / {totalPages}
        </span>
        <button
          class="rounded-md border border-border px-3 py-1 text-caption font-medium transition-[background-color,border-color] duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={data.page >= totalPages}
          onclick={() => gotoPage(data.page + 1)}
        >
          {m.editorial_pageNext()}
        </button>
      </nav>
    {/if}
  {/if}
</Section>

<ConfirmDialog
  open={pendingDeleteId !== null}
  title={m.editorial_confirmDeleteTitle()}
  message={m.editorial_confirmDelete()}
  variant="danger"
  confirmText={deleting ? m.editorial_deleting() : m.editorial_delete()}
  cancelText={m.common_cancel()}
  onconfirm={confirmDelete}
  oncancel={() => (pendingDeleteId = null)}
/>
