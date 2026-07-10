<script lang="ts">
  import { untrack } from "svelte";
  import { ArrowLeft, ChevronDown, ChevronUp } from "@lucide/svelte";
  import { goto } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import ConfirmDialog from "$lib/components/primitives/ui/ConfirmDialog.svelte";
  import MarkdownRenderer from "$lib/components/primitives/layout/MarkdownRenderer.svelte";
  import { fetchWithCsrf } from "$lib/services/http";
  import { toasts } from "$lib/stores/toast";
  import { formatDate } from "$lib/utils/datetime";
  import ReportDialog from "./ReportDialog.svelte";
  import type { PostDetail } from "./types";

  interface Props {
    post: PostDetail;
    basePath: string;
    viewerId: string;
    isAdmin: boolean;
  }

  let { post, basePath, viewerId, isAdmin }: Props = $props();

  let voteScore = $state(untrack(() => post.voteScore));
  let viewerVote = $state(untrack(() => post.viewerVote));
  let voting = $state(false);
  let reportOpen = $state(false);
  let confirmDeleteOpen = $state(false);
  let deleting = $state(false);

  const isOwn = $derived(post.authorId === viewerId);
  const canManage = $derived(isOwn || isAdmin);

  async function vote(direction: 1 | -1) {
    if (voting) return;
    const value = viewerVote === direction ? 0 : direction;
    voting = true;
    try {
      const res = await fetchWithCsrf(`/api/posts/${post.id}/votes`, {
        method: "POST",
        body: JSON.stringify({ value }),
      });
      if (res.ok) {
        const result: { score: number; viewerVote: number } = await res.json();
        voteScore = result.score;
        viewerVote = result.viewerVote;
      } else {
        const body = await res.json().catch(() => null);
        toasts.error(body?.message ?? m.posts_voteError());
      }
    } catch {
      toasts.error(m.posts_voteError());
    } finally {
      voting = false;
    }
  }

  async function confirmDelete() {
    if (deleting) return;
    deleting = true;
    try {
      const res = await fetchWithCsrf(`/api/posts/${post.id}`, { method: "DELETE" });
      if (res.ok) {
        toasts.success(m.posts_deletedToast());
        confirmDeleteOpen = false;
        await goto(basePath);
      } else {
        toasts.error(m.posts_deleteError());
      }
    } catch {
      toasts.error(m.posts_deleteError());
    } finally {
      deleting = false;
    }
  }
</script>

<article>
  <a
    href={basePath}
    class="mb-4 inline-flex items-center gap-1.5 text-caption font-medium text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-foreground"
  >
    <ArrowLeft aria-hidden="true" class="h-3.5 w-3.5" />
    {m.posts_backToList()}
  </a>

  <div class="flex items-start gap-3">
    <div class="flex shrink-0 flex-col items-center gap-0.5">
      <button
        aria-label={m.posts_upvote()}
        aria-pressed={viewerVote === 1}
        class="grid h-6 w-6 place-items-center rounded transition-colors duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 {viewerVote ===
        1
          ? 'text-success'
          : 'text-muted-foreground'}"
        disabled={isOwn || voting}
        onclick={() => vote(1)}
        type="button"
      >
        <ChevronUp aria-hidden="true" class="h-4 w-4" />
      </button>
      <span class="text-body-sm font-semibold tabular-nums">{voteScore}</span>
      <button
        aria-label={m.posts_downvote()}
        aria-pressed={viewerVote === -1}
        class="grid h-6 w-6 place-items-center rounded transition-colors duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 {viewerVote ===
        -1
          ? 'text-destructive'
          : 'text-muted-foreground'}"
        disabled={isOwn || voting}
        onclick={() => vote(-1)}
        type="button"
      >
        <ChevronDown aria-hidden="true" class="h-4 w-4" />
      </button>
    </div>
    <div class="min-w-0 flex-1">
      <h1 class="text-title-lg leading-snug">{post.title}</h1>
      <div class="mt-1 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
        <span class="font-medium text-foreground">{post.author.name}</span>
        <span class="tabular-nums">{formatDate(post.createdAt)}</span>
        {#if !isOwn}
          <button
            class="transition-[color] duration-fast ease-out-soft hover:text-destructive"
            onclick={() => (reportOpen = true)}
            type="button"
          >
            {m.posts_report()}
          </button>
        {/if}
        {#if canManage}
          <a
            href="{basePath}/{post.id}/edit"
            class="transition-[color] duration-fast ease-out-soft hover:text-foreground"
          >
            {m.posts_edit()}
          </a>
          <button
            class="transition-[color] duration-fast ease-out-soft hover:text-destructive"
            onclick={() => (confirmDeleteOpen = true)}
            type="button"
          >
            {m.posts_delete()}
          </button>
        {/if}
      </div>
    </div>
  </div>

  <div class="mt-4 text-body leading-relaxed">
    <MarkdownRenderer content={post.content} />
  </div>
</article>

<ReportDialog bind:open={reportOpen} endpoint="/api/posts/{post.id}/reports" />

<ConfirmDialog
  open={confirmDeleteOpen}
  title={m.posts_deleteConfirmTitle()}
  message={m.posts_deleteConfirm()}
  variant="danger"
  confirmText={deleting ? m.posts_deleting() : m.posts_delete()}
  onconfirm={confirmDelete}
  oncancel={() => (confirmDeleteOpen = false)}
/>
