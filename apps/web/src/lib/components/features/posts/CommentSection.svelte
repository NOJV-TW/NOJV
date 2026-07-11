<script lang="ts">
  import type { ProblemPostType } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import ConfirmDialog from "$lib/components/primitives/ui/ConfirmDialog.svelte";
  import { fetchWithCsrf } from "$lib/services/http";
  import { toasts } from "$lib/stores/toast";
  import { relativeTime } from "$lib/utils/relative-time";
  import ReportDialog from "./ReportDialog.svelte";
  import type { PostCommentEntry } from "./types";

  interface Props {
    postId: string;
    type: ProblemPostType;
    viewerId: string;
    isAdmin: boolean;
  }

  let { postId, type, viewerId, isAdmin }: Props = $props();

  const uid = $props.id();

  let comments = $state<PostCommentEntry[]>([]);
  let loaded = $state(false);
  let loadFailed = $state(false);
  let newComment = $state("");
  let replyTo = $state<string | null>(null);
  let replyContent = $state("");
  let submitting = $state(false);
  let reportingCommentId = $state<string | null>(null);
  let reportOpen = $state(false);
  let pendingDeleteId = $state<string | null>(null);
  let deleting = $state(false);

  const topLevel = $derived(comments.filter((c) => c.parentId === null));
  const repliesByParent = $derived(
    comments.reduce((map, c) => {
      if (c.parentId !== null) {
        const list = map.get(c.parentId) ?? [];
        list.push(c);
        map.set(c.parentId, list);
      }
      return map;
    }, new Map<string, PostCommentEntry[]>()),
  );

  function canDelete(comment: PostCommentEntry): boolean {
    return comment.authorId === viewerId || isAdmin;
  }

  async function refresh() {
    try {
      const res = await fetch(`/api/posts/${postId}/comments`);
      if (!res.ok) {
        loadFailed = !loaded;
        return;
      }
      const rows: PostCommentEntry[] = await res.json();
      comments = rows.map((row) => ({
        id: row.id,
        parentId: row.parentId,
        content: row.content,
        createdAt: row.createdAt,
        authorId: row.authorId,
        author: row.author,
        deleted: row.deleted,
      }));
      loaded = true;
      loadFailed = false;
    } catch {
      loadFailed = !loaded;
    }
  }

  $effect(() => {
    void refresh();
  });

  async function submitComment(content: string, parentId: string | null) {
    if (submitting || content.trim().length === 0) return;
    submitting = true;
    try {
      const res = await fetchWithCsrf(`/api/posts/${postId}/comments`, {
        method: "POST",
        body: JSON.stringify(parentId ? { content, parentId } : { content }),
      });
      if (res.status === 201) {
        if (parentId) {
          replyTo = null;
          replyContent = "";
        } else {
          newComment = "";
        }
        await refresh();
      } else {
        const body = await res.json().catch(() => null);
        toasts.error(body?.message ?? m.posts_commentError());
      }
    } catch {
      toasts.error(m.posts_commentError());
    } finally {
      submitting = false;
    }
  }

  async function confirmDelete() {
    if (!pendingDeleteId || deleting) return;
    deleting = true;
    try {
      const res = await fetchWithCsrf(`/api/comments/${pendingDeleteId}`, { method: "DELETE" });
      if (res.ok) {
        pendingDeleteId = null;
        await refresh();
      } else {
        toasts.error(m.posts_deleteCommentError());
      }
    } catch {
      toasts.error(m.posts_deleteCommentError());
    } finally {
      deleting = false;
    }
  }

  function openReport(commentId: string) {
    reportingCommentId = commentId;
    reportOpen = true;
  }

  function toggleReply(commentId: string) {
    replyTo = replyTo === commentId ? null : commentId;
    replyContent = "";
  }
</script>

{#snippet commentBody(comment: PostCommentEntry)}
  <div class="flex flex-wrap items-baseline gap-2 text-caption text-muted-foreground">
    <span class="font-medium text-foreground">{comment.author.name}</span>
    <span class="tabular-nums">{relativeTime(comment.createdAt)}</span>
  </div>
  {#if comment.deleted}
    <p class="mt-1 text-body-sm text-muted-foreground italic">{m.posts_commentDeleted()}</p>
  {:else}
    <p class="mt-1 text-body-sm whitespace-pre-wrap leading-6">{comment.content}</p>
    <div class="mt-1 flex items-center gap-3 text-caption text-muted-foreground">
      {#if comment.parentId === null}
        <button
          class="transition-[color] duration-fast ease-out-soft hover:text-foreground"
          onclick={() => toggleReply(comment.id)}
          type="button"
        >
          {m.posts_reply()}
        </button>
      {/if}
      {#if comment.authorId !== viewerId}
        <button
          class="transition-[color] duration-fast ease-out-soft hover:text-destructive"
          onclick={() => openReport(comment.id)}
          type="button"
        >
          {m.posts_report()}
        </button>
      {/if}
      {#if canDelete(comment)}
        <button
          class="transition-[color] duration-fast ease-out-soft hover:text-destructive"
          onclick={() => (pendingDeleteId = comment.id)}
          type="button"
        >
          {m.posts_delete()}
        </button>
      {/if}
    </div>
  {/if}
{/snippet}

<section class="mt-8">
  <h2 class="text-body font-semibold">
    {m.posts_comments()}
    <span class="text-muted-foreground tabular-nums">({comments.length})</span>
  </h2>

  {#if type === "discussion"}
    <p class="mt-1 text-caption text-muted-foreground">{m.posts_spoilerHint()}</p>
  {/if}

  {#if loadFailed}
    <p class="mt-3 text-body-sm text-muted-foreground">{m.posts_loadError()}</p>
  {/if}

  <div class="mt-3">
    <label class="sr-only" for="{uid}-comment-input">{m.posts_commentPlaceholder()}</label>
    <textarea
      id="{uid}-comment-input"
      class="w-full rounded-md border border-border bg-background px-3 py-2 text-body-sm leading-6"
      rows="3"
      maxlength="5000"
      placeholder={m.posts_commentPlaceholder()}
      bind:value={newComment}></textarea>
    <div class="mt-2">
      <Button
        size="sm"
        disabled={submitting || newComment.trim().length === 0}
        onclick={() => submitComment(newComment, null)}
      >
        {submitting ? m.posts_commentSubmitting() : m.posts_commentSubmit()}
      </Button>
    </div>
  </div>

  <ul class="mt-5 flex flex-col gap-4">
    {#each topLevel as comment (comment.id)}
      <li class="rounded-md border border-border-subtle p-3">
        {@render commentBody(comment)}

        {#if replyTo === comment.id}
          <div class="mt-3 border-l-2 border-border-subtle pl-4">
            <label class="sr-only" for="{uid}-reply-input-{comment.id}">
              {m.posts_replyPlaceholder()}
            </label>
            <textarea
              id="{uid}-reply-input-{comment.id}"
              class="w-full rounded-md border border-border bg-background px-3 py-2 text-body-sm leading-6"
              rows="2"
              maxlength="5000"
              placeholder={m.posts_replyPlaceholder()}
              bind:value={replyContent}></textarea>
            <div class="mt-2 flex items-center gap-2">
              <Button
                size="sm"
                disabled={submitting || replyContent.trim().length === 0}
                onclick={() => submitComment(replyContent, comment.id)}
              >
                {submitting ? m.posts_commentSubmitting() : m.posts_reply()}
              </Button>
              <Button size="sm" variant="ghost" onclick={() => (replyTo = null)}>
                {m.common_cancel()}
              </Button>
            </div>
          </div>
        {/if}

        {#if repliesByParent.get(comment.id)?.length}
          <ul class="mt-3 flex flex-col gap-3 border-l-2 border-border-subtle pl-4">
            {#each repliesByParent.get(comment.id) ?? [] as reply (reply.id)}
              <li>
                {@render commentBody(reply)}
              </li>
            {/each}
          </ul>
        {/if}
      </li>
    {/each}
  </ul>
</section>

{#if reportingCommentId !== null}
  <ReportDialog bind:open={reportOpen} endpoint="/api/comments/{reportingCommentId}/reports" />
{/if}

<ConfirmDialog
  open={pendingDeleteId !== null}
  title={m.posts_commentDeleteConfirmTitle()}
  message={m.posts_commentDeleteConfirm()}
  variant="danger"
  confirmText={deleting ? m.posts_deleting() : m.posts_delete()}
  onconfirm={confirmDelete}
  oncancel={() => (pendingDeleteId = null)}
/>
