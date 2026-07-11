<script lang="ts">
  import { Lock } from "@lucide/svelte";
  import { postListResponseSchema, type PostListSort, type ProblemPostType } from "@nojv/core";
  import { page } from "$app/state";
  import { m } from "$lib/paraglide/messages.js";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import PostListView from "$lib/components/features/posts/PostListView.svelte";
  import PostArticleView from "$lib/components/features/posts/PostArticleView.svelte";
  import PostForm from "$lib/components/features/posts/PostForm.svelte";
  import type { PostListItem } from "$lib/components/features/posts/types";

  interface Props {
    problemId: string;
    type: ProblemPostType;
    canView: boolean;
  }

  let { problemId, type, canView }: Props = $props();

  type View =
    | { kind: "list" }
    | { kind: "article"; postId: string }
    | { kind: "compose"; post?: { id: string; title: string; content: string } | undefined };

  let view = $state<View>({ kind: "list" });

  const pageSize = 20;
  let items = $state<PostListItem[]>([]);
  let total = $state(0);
  let pageNum = $state(1);
  let sort = $state<PostListSort>("new");
  let loading = $state(false);
  let loaded = $state(false);
  let forbidden = $state(false);
  let loadFailed = $state(false);

  const viewerId = $derived(page.data.user?.id ?? "");
  const isAdmin = $derived(
    page.data.user?.platformRole === "admin" && (page.data.actingAsAdmin ?? false),
  );

  let requestSeq = 0;

  async function loadList(target: number) {
    const seq = ++requestSeq;
    loading = true;
    try {
      const res = await fetch(
        `/api/problems/${problemId}/posts?type=${type}&page=${target}&pageSize=${pageSize}&sort=${sort}`,
      );
      if (seq !== requestSeq) return;
      if (res.ok) {
        const parsed = postListResponseSchema.safeParse(await res.json());
        if (seq !== requestSeq) return;
        if (parsed.success) {
          const lastPage = Math.max(1, Math.ceil(parsed.data.total / pageSize));
          if (parsed.data.items.length === 0 && parsed.data.page > lastPage) {
            void loadList(lastPage);
            return;
          }
          items = parsed.data.items;
          total = parsed.data.total;
          pageNum = parsed.data.page;
          loadFailed = false;
        } else {
          loadFailed = true;
        }
        forbidden = false;
      } else {
        forbidden = res.status === 403;
        loadFailed = res.status !== 403;
      }
      loaded = true;
    } catch {
      if (seq !== requestSeq) return;
      loadFailed = true;
      loaded = true;
    } finally {
      if (seq === requestSeq) {
        loading = false;
      }
    }
  }

  $effect(() => {
    if (canView && !loaded && !loading) {
      void loadList(1);
    }
  });

  function backToList() {
    view = { kind: "list" };
    void loadList(pageNum);
  }

  function onSortChange(next: PostListSort) {
    if (sort === next) return;
    sort = next;
    void loadList(1);
  }
</script>

<div class="p-5">
  {#if !canView || forbidden}
    <EmptyState
      variant="minimal"
      icon={Lock}
      title={type === "editorial"
        ? forbidden
          ? m.editorials_lockedDuringEvent()
          : m.editorials_solveFirst()
        : m.posts_lockedDuringEvent()}
    />
  {:else if view.kind === "article"}
    <PostArticleView
      postId={view.postId}
      {type}
      {viewerId}
      {isAdmin}
      onBack={backToList}
      onEdit={(post) => (view = { kind: "compose", post })}
      onDeleted={backToList}
    />
  {:else if view.kind === "compose"}
    {@const editingPost = view.post}
    <PostForm
      {type}
      {problemId}
      post={editingPost}
      onSaved={(id) => (view = { kind: "article", postId: id })}
      onCancel={() =>
        (view = editingPost ? { kind: "article", postId: editingPost.id } : { kind: "list" })}
    />
  {:else if loading && !loaded}
    <div class="flex items-center justify-center py-8">
      <div
        class="size-5 animate-spin rounded-full border-2 border-border border-t-foreground"
      ></div>
    </div>
  {:else if loadFailed}
    <p class="text-body-sm text-muted-foreground">{m.posts_loadError()}</p>
  {:else}
    <PostListView
      {type}
      posts={items}
      {total}
      page={pageNum}
      {pageSize}
      {sort}
      onOpen={(postId) => (view = { kind: "article", postId })}
      onCompose={() => (view = { kind: "compose" })}
      onPageChange={(target) => void loadList(target)}
      {onSortChange}
    />
  {/if}
</div>
