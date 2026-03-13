<script lang="ts">
  import { enhance } from "$app/forms";
  import { Badge } from "$lib/components/ui/badge";

  let { data } = $props();

  let editingId = $state<string | null>(null);
</script>

<div class="space-y-6">
  <!-- Create Form -->
  <div
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
  >
    <h3 class="text-lg font-semibold">New Announcement</h3>
    <form class="mt-4 space-y-3" method="POST" action="?/create" use:enhance>
      <input
        class="w-full rounded-2xl border border-border bg-white/60 px-3 py-2 text-sm"
        name="title"
        placeholder="Title"
        required
      />
      <textarea
        class="w-full rounded-2xl border border-border bg-white/60 px-3 py-2 text-sm"
        name="content"
        placeholder="Content (Markdown supported)"
        required
        rows="4"
      ></textarea>
      <div class="flex flex-wrap items-center gap-4">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" name="pinned" />
          Pinned
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" name="published" />
          Published
        </label>
      </div>
      <button
        class="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5"
        type="submit"
      >
        Create Announcement
      </button>
    </form>
  </div>

  <!-- Announcements List -->
  <div
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
  >
    <div class="flex items-center justify-between gap-4">
      <h3 class="text-lg font-semibold">Announcements</h3>
      <span class="rounded-full border border-border px-3 py-1 text-xs font-medium">
        {data.announcements.length}
      </span>
    </div>

    {#if data.announcements.length === 0}
      <p class="mt-4 text-sm text-muted-foreground">No announcements yet.</p>
    {:else}
      <div class="mt-4 space-y-3">
        {#each data.announcements as ann (ann.id)}
          <article
            class="rounded-[1.5rem] border border-border bg-white/40 px-5 py-4"
          >
            {#if editingId === ann.id}
              <!-- Edit mode -->
              <form
                class="space-y-3"
                method="POST"
                action="?/update"
                use:enhance={() => {
                  return async ({ update }) => {
                    editingId = null;
                    await update();
                  };
                }}
              >
                <input type="hidden" name="id" value={ann.id} />
                <input
                  class="w-full rounded-2xl border border-border bg-white/60 px-3 py-2 text-sm"
                  name="title"
                  value={ann.title}
                  required
                />
                <textarea
                  class="w-full rounded-2xl border border-border bg-white/60 px-3 py-2 text-sm"
                  name="content"
                  rows="4"
                  required
                >{ann.content}</textarea>
                <div class="flex flex-wrap items-center gap-4">
                  <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="pinned" checked={ann.pinned} />
                    Pinned
                  </label>
                  <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="published" checked={ann.published} />
                    Published
                  </label>
                </div>
                <div class="flex gap-2">
                  <button
                    class="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5"
                    type="submit"
                  >
                    Save
                  </button>
                  <button
                    class="rounded-full border border-border px-4 py-2 text-sm transition hover:-translate-y-0.5"
                    type="button"
                    onclick={() => (editingId = null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            {:else}
              <!-- View mode -->
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <h4 class="text-base font-semibold">{ann.title}</h4>
                    {#if ann.pinned}
                      <Badge variant="default">Pinned</Badge>
                    {/if}
                    {#if ann.published}
                      <Badge variant="secondary">Published</Badge>
                    {:else}
                      <Badge variant="outline">Draft</Badge>
                    {/if}
                  </div>
                  <p class="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">
                    {ann.content.length > 200 ? ann.content.slice(0, 200) + "..." : ann.content}
                  </p>
                  <p class="mt-2 text-xs text-muted-foreground">
                    Created: {new Date(ann.createdAt).toLocaleString()} &middot;
                    Updated: {new Date(ann.updatedAt).toLocaleString()}
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <button
                    class="rounded-full border border-border px-3 py-1 text-xs transition hover:-translate-y-0.5 hover:bg-white/70"
                    type="button"
                    onclick={() => (editingId = ann.id)}
                  >
                    Edit
                  </button>
                  <form method="POST" action="?/togglePin" use:enhance>
                    <input type="hidden" name="id" value={ann.id} />
                    <button
                      class="rounded-full border border-border px-3 py-1 text-xs transition hover:-translate-y-0.5 hover:bg-white/70"
                      type="submit"
                    >
                      {ann.pinned ? "Unpin" : "Pin"}
                    </button>
                  </form>
                  <form method="POST" action="?/togglePublish" use:enhance>
                    <input type="hidden" name="id" value={ann.id} />
                    <button
                      class="rounded-full border border-border px-3 py-1 text-xs transition hover:-translate-y-0.5 hover:bg-white/70"
                      type="submit"
                    >
                      {ann.published ? "Unpublish" : "Publish"}
                    </button>
                  </form>
                  <form
                    method="POST"
                    action="?/delete"
                    use:enhance={({ cancel }) => {
                      if (!confirm("Delete this announcement?")) {
                        cancel();
                      }
                    }}
                  >
                    <input type="hidden" name="id" value={ann.id} />
                    <button
                      class="rounded-full border border-border px-3 py-1 text-xs text-red-600 transition hover:-translate-y-0.5 hover:bg-red-50"
                      type="submit"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </div>
</div>
