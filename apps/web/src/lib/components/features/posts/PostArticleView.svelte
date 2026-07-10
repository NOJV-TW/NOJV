<script lang="ts">
  import { ArrowLeft, ChevronDown, ChevronUp } from "@lucide/svelte";
  import type { ProblemPostType } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import ConfirmDialog from "$lib/components/primitives/ui/ConfirmDialog.svelte";
  import MarkdownRenderer from "$lib/components/primitives/layout/MarkdownRenderer.svelte";
  import { fetchWithCsrf } from "$lib/services/http";
  import { toasts } from "$lib/stores/toast";
  import { formatDate } from "$lib/utils/datetime";
  import CommentSection from "./CommentSection.svelte";
  import ReportDialog from "./ReportDialog.svelte";
  import type { PostDetail } from "./types";

  interface Props {
    postId: string;
    type: ProblemPostType;
    viewerId: string;
    isAdmin: boolean;
    onBack: () => void;
    onEdit: (post: { id: string; title: string; content: string }) => void;
    onDeleted: () => void;
  }

  let { postId, type, viewerId, isAdmin, onBack, onEdit, onDeleted }: Props = $props();

  let post = $state<PostDetail | null>(null);
  let loading = $state(true);
  let loadFailed = $state(false);
  let voting = $state(false);
  let reportOpen = $state(false);
  let confirmDeleteOpen = $state(false);
  let deleting = $state(false);

  const isOwn = $derived(post !== null && post.authorId === viewerId);
  const canManage = $derived(isOwn || isAdmin);

  $effect(() => {
    void load(postId);
  });

  async function load(id: string) {
    loading = true;
    try {
      const res = await fetch(`/api/posts/${id}`);
      if (res.ok) {
        post = (await res.json()) as PostDetail;
        loadFailed = false;
      } else {
        loadFailed = true;
      }
    } catch {
      loadFailed = true;
    } finally {
      loading = false;
    }
  }

  async function vote(direction: 1 | -1) {
    if (voting || post === null) return;
    const target = post;
    const value = target.viewerVote === direction ? 0 : direction;
    voting = true;
    try {
      const res = await fetchWithCsrf(`/api/posts/${target.id}/votes`, {
        method: "POST",
        body: JSON.stringify({ value }),
      });
      if (res.ok) {
        const result: { score: number; viewerVote: number } = await res.json();
        post = { ...target, voteScore: result.score, viewerVote: result.viewerVote };
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
    if (deleting || post === null) return;
    deleting = true;
    try {
      const res = await fetchWithCsrf(`/api/posts/${post.id}`, { method: "DELETE" });
      if (res.ok) {
        toasts.success(m.posts_deletedToast());
        confirmDeleteOpen = false;
        onDeleted();
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

<button
  class="mb-4 inline-flex items-center gap-1.5 text-caption font-medium text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-foreground"
  onclick={onBack}
  type="button"
>
  <ArrowLeft aria-hidden="true" class="h-3.5 w-3.5" />
  {m.posts_backToList()}
</button>

{#if loading}
  <div class="flex items-center justify-center py-8">
    <div
      class="size-5 animate-spin rounded-full border-2 border-border border-t-foreground"
    ></div>
  </div>
{:else if loadFailed || post === null}
  <p class="text-body-sm text-muted-foreground">{m.posts_loadError()}</p>
{:else}
  <article>
    <div class="flex items-start gap-3">
      <div class="flex shrink-0 flex-col items-center gap-0.5">
        <button
          aria-label={m.posts_upvote()}
          aria-pressed={post.viewerVote === 1}
          class="grid h-6 w-6 place-items-center rounded transition-colors duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 {post.viewerVote ===
          1
            ? 'text-success'
            : 'text-muted-foreground'}"
          disabled={isOwn || voting}
          onclick={() => vote(1)}
          type="button"
        >
          <ChevronUp aria-hidden="true" class="h-4 w-4" />
        </button>
        <span class="text-body-sm font-semibold tabular-nums">{post.voteScore}</span>
        <button
          aria-label={m.posts_downvote()}
          aria-pressed={post.viewerVote === -1}
          class="grid h-6 w-6 place-items-center rounded transition-colors duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 {post.viewerVote ===
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
        <h2 class="text-body font-semibold leading-snug">{post.title}</h2>
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
            <button
              class="transition-[color] duration-fast ease-out-soft hover:text-foreground"
              onclick={() => post !== null && onEdit(post)}
              type="button"
            >
              {m.posts_edit()}
            </button>
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

  <CommentSection postId={post.id} {type} {viewerId} {isAdmin} />

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
{/if}
