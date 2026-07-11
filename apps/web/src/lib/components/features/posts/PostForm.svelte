<script lang="ts">
  import { untrack } from "svelte";
  import type { ProblemPostType } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import ImageDropZone from "$lib/components/primitives/ui/ImageDropZone.svelte";
  import { fetchWithCsrf } from "$lib/services/http";
  import { toasts } from "$lib/stores/toast";

  interface Props {
    type: ProblemPostType;
    problemId: string;
    post?: { id: string; title: string; content: string } | undefined;
    onSaved: (id: string) => void;
    onCancel: () => void;
  }

  let { type, problemId, post, onSaved, onCancel }: Props = $props();

  const uid = $props.id();

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
        onSaved(body.id);
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
  {#if type === "discussion"}
    <p class="text-caption text-muted-foreground">{m.posts_spoilerHint()}</p>
  {/if}
  <div>
    <label
      class="mb-1 block text-caption font-medium text-muted-foreground"
      for="{uid}-post-title"
    >
      {m.posts_titleLabel()}
    </label>
    <input
      id="{uid}-post-title"
      class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-body-sm"
      maxlength="200"
      placeholder={m.posts_titlePlaceholder()}
      bind:value={title}
    />
  </div>
  <div>
    <label
      class="mb-1 block text-caption font-medium text-muted-foreground"
      for="{uid}-post-content"
    >
      {m.posts_contentLabel()}
    </label>
    <ImageDropZone
      id="{uid}-post-content"
      class="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-body-sm leading-6"
      rows="10"
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
    <Button variant="outline" onclick={onCancel}>
      {m.common_cancel()}
    </Button>
  </div>
</div>
