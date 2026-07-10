<script lang="ts">
  import { untrack } from "svelte";
  import type { ProblemPostType } from "@nojv/core";
  import { goto } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import ImageDropZone from "$lib/components/primitives/ui/ImageDropZone.svelte";
  import { fetchWithCsrf } from "$lib/services/http";
  import { toasts } from "$lib/stores/toast";

  interface Props {
    type: ProblemPostType;
    problemId: string;
    basePath: string;
    post?: { id: string; title: string; content: string } | undefined;
  }

  let { type, problemId, basePath, post }: Props = $props();

  let title = $state(untrack(() => post?.title ?? ""));
  let content = $state(untrack(() => post?.content ?? ""));
  let saving = $state(false);

  const valid = $derived(
    title.trim().length >= 1 &&
      title.trim().length <= 200 &&
      content.length >= 10 &&
      content.length <= 50000,
  );

  async function submit() {
    if (!valid || saving) return;
    saving = true;
    try {
      const res = post
        ? await fetchWithCsrf(`/api/posts/${post.id}`, {
            method: "PATCH",
            body: JSON.stringify({ title: title.trim(), content }),
          })
        : await fetchWithCsrf(`/api/problems/${problemId}/posts`, {
            method: "POST",
            body: JSON.stringify({ type, title: title.trim(), content }),
          });
      if (res.ok) {
        const body: { id: string } = await res.json();
        toasts.success(post ? m.posts_savedToast() : m.posts_publishedToast());
        await goto(`${basePath}/${body.id}`);
      } else {
        const body = await res.json().catch(() => null);
        toasts.error(body?.message ?? (post ? m.posts_saveError() : m.posts_submitError()));
      }
    } catch {
      toasts.error(post ? m.posts_saveError() : m.posts_submitError());
    } finally {
      saving = false;
    }
  }
</script>

<div class="grid gap-4">
  <div>
    <label
      class="mb-1 block text-caption font-medium text-muted-foreground"
      for="post-form-title"
    >
      {m.posts_titleLabel()}
    </label>
    <input
      id="post-form-title"
      class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-body-sm"
      maxlength="200"
      placeholder={m.posts_titlePlaceholder()}
      bind:value={title}
    />
  </div>
  <div>
    <label
      class="mb-1 block text-caption font-medium text-muted-foreground"
      for="post-form-content"
    >
      {m.posts_contentLabel()}
    </label>
    <ImageDropZone
      id="post-form-content"
      class="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-body-sm leading-6"
      rows="16"
      name="content"
      placeholder={m.posts_contentPlaceholder()}
      bind:value={content}
    />
    <p class="mt-1 text-micro text-muted-foreground tabular-nums">
      {content.length} / 50000
    </p>
  </div>
  <div class="flex items-center gap-2">
    <Button disabled={!valid || saving} onclick={submit}>
      {#if post}
        {saving ? m.posts_saving() : m.posts_save()}
      {:else}
        {saving ? m.posts_submitting() : m.posts_submit()}
      {/if}
    </Button>
    <a
      href={post ? `${basePath}/${post.id}` : basePath}
      class="rounded-md border border-border px-4 py-1.5 text-caption font-medium transition-[background-color,border-color] duration-fast ease-out-soft hover:bg-accent"
    >
      {m.common_cancel()}
    </a>
  </div>
</div>
