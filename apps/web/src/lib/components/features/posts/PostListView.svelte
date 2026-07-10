<script lang="ts">
  import { BookOpen, ChevronUp, MessageSquare, MessagesSquare } from "@lucide/svelte";
  import type { ProblemPostType } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import { Button } from "$lib/components/primitives/ui/button";
  import { relativeTime } from "$lib/utils/relative-time";
  import type { PostListItem } from "./types";

  interface Props {
    type: ProblemPostType;
    posts: PostListItem[];
    total: number;
    page: number;
    pageSize: number;
    sort: "latest" | "top";
    onOpen: (postId: string) => void;
    onCompose: () => void;
    onPageChange: (page: number) => void;
    onSortChange: (sort: "latest" | "top") => void;
  }

  let {
    type,
    posts,
    total,
    page,
    pageSize,
    sort,
    onOpen,
    onCompose,
    onPageChange,
    onSortChange,
  }: Props = $props();

  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  const sorted = $derived(
    sort === "top" ? [...posts].sort((a, b) => b.voteScore - a.voteScore) : posts,
  );
</script>

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
  <div class="flex items-center gap-1" role="group" aria-label={m.posts_sortAriaLabel()}>
    {#each [{ value: "latest", label: m.posts_sortLatest() }, { value: "top", label: m.posts_sortTop() }] as option (option.value)}
      <button
        type="button"
        aria-pressed={sort === option.value}
        class="rounded-md border px-3 py-1 text-caption font-medium transition-[background-color,border-color,color] duration-fast ease-out-soft {sort ===
        option.value
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'}"
        onclick={() => onSortChange(option.value as "latest" | "top")}
      >
        {option.label}
      </button>
    {/each}
  </div>
  <Button size="sm" onclick={onCompose}>
    {type === "editorial" ? m.posts_newEditorialTitle() : m.posts_newDiscussionTitle()}
  </Button>
</div>

{#if type === "discussion"}
  <p class="mb-4 text-caption text-muted-foreground">{m.posts_spoilerHint()}</p>
{/if}

{#if posts.length === 0}
  <EmptyState
    variant="minimal"
    icon={type === "editorial" ? BookOpen : MessagesSquare}
    title={type === "editorial" ? m.posts_emptyEditorials() : m.posts_emptyDiscussions()}
    description={type === "editorial"
      ? m.posts_emptyHintEditorials()
      : m.posts_emptyHintDiscussions()}
  />
{:else}
  <ul class="flex flex-col gap-2">
    {#each sorted as post (post.id)}
      <li>
        <button
          type="button"
          onclick={() => onOpen(post.id)}
          class="flex w-full items-center gap-3 rounded-md border border-border-subtle p-3 text-left transition-[border-color,background-color] duration-fast ease-out-soft hover:border-border hover:bg-muted/40"
        >
          <span class="flex w-9 shrink-0 flex-col items-center rounded-md bg-muted px-1 py-1.5">
            <ChevronUp aria-hidden="true" class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="text-caption font-semibold tabular-nums">{post.voteScore}</span>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-body-sm font-medium text-foreground">
              {post.title}
            </span>
            <span class="mt-0.5 flex items-center gap-2 text-caption text-muted-foreground">
              <span class="truncate">{post.author.name}</span>
              <span class="tabular-nums">{relativeTime(post.createdAt)}</span>
            </span>
          </span>
          <span
            class="flex shrink-0 items-center gap-1 text-caption text-muted-foreground tabular-nums"
          >
            <MessageSquare aria-hidden="true" class="h-3.5 w-3.5" />
            {post.commentCount}
          </span>
        </button>
      </li>
    {/each}
  </ul>

  {#if totalPages > 1}
    <nav
      class="mt-6 flex items-center justify-center gap-2"
      aria-label={m.problems_pagination()}
    >
      {#if page > 1}
        <button
          type="button"
          onclick={() => onPageChange(page - 1)}
          class="rounded-md border border-border px-3 py-1 text-caption font-medium transition-[background-color,border-color] duration-fast ease-out-soft hover:bg-accent"
        >
          {m.posts_pagePrev()}
        </button>
      {/if}
      <span class="text-caption text-muted-foreground tabular-nums">
        {page} / {totalPages}
      </span>
      {#if page < totalPages}
        <button
          type="button"
          onclick={() => onPageChange(page + 1)}
          class="rounded-md border border-border px-3 py-1 text-caption font-medium transition-[background-color,border-color] duration-fast ease-out-soft hover:bg-accent"
        >
          {m.posts_pageNext()}
        </button>
      {/if}
    </nav>
  {/if}
{/if}
