<script lang="ts">
  import { enhance } from "$app/forms";
  import { Badge } from "$lib/components/ui/badge";
  import { Button, IconButton } from "$lib/components/ui/button";
  import { Card } from "$lib/components/ui/card";
  import Section from "$lib/components/ui/Section.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import FormField from "$lib/components/ui/FormField.svelte";
  import { Input } from "$lib/components/ui/input";
  import { m } from "$lib/paraglide/messages.js";
  import {
    Megaphone,
    Pencil,
    Pin,
    PinOff,
    Plus,
    Send,
    SendHorizonal,
    Trash2
  } from "@lucide/svelte";

  let { data } = $props();

  let editingId = $state<string | null>(null);
  let showCreateForm = $state(false);
</script>

<Section class="space-y-6">
  {#snippet header()}
    <h2 class="inline-flex items-center gap-3">
      {m.admin_announcementsTitle()}
      <Badge variant="muted" size="sm">{data.announcements.length}</Badge>
    </h2>
    <p>{m.admin_announcementsSubtitle()}</p>
  {/snippet}
  {#snippet actions()}
    <Button
      variant="default"
      size="default"
      type="button"
      onclick={() => (showCreateForm = !showCreateForm)}
    >
      <Plus class="h-4 w-4" />
      {m.admin_announcementsNew()}
    </Button>
  {/snippet}

  {#if showCreateForm}
    <Card variant="flat" size="md">
      <h3 class="font-display text-title-sm font-semibold">{m.admin_announcementsNew()}</h3>
      <form class="space-y-4" method="POST" action="?/create" use:enhance>
        <FormField label={m.admin_announcementsFieldTitle()} for="create-title" required>
          <Input
            id="create-title"
            name="title"
            placeholder={m.admin_announcementsFieldTitle()}
            required
          />
        </FormField>
        <FormField
          label={m.admin_announcementsFieldContent()}
          hint={m.admin_announcementsMarkdownHint()}
          for="create-content"
          required
        >
          <textarea
            id="create-content"
            class="flex min-h-32 w-full min-w-0 rounded-sm border border-input bg-background px-3 py-2 text-body shadow-rest outline-none transition-[border-color,box-shadow] duration-fast ease-out-soft placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            name="content"
            placeholder={m.admin_announcementsFieldContent()}
            required
            rows="4"
          ></textarea>
        </FormField>
        <div class="flex flex-wrap items-center gap-4">
          <label class="flex items-center gap-2 text-body-sm">
            <input type="checkbox" name="pinned" class="size-4" />
            {m.admin_announcementsPinned()}
          </label>
          <label class="flex items-center gap-2 text-body-sm">
            <input type="checkbox" name="published" class="size-4" />
            {m.admin_announcementsPublished()}
          </label>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="default">
            {m.admin_announcementsCreate()}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onclick={() => (showCreateForm = false)}
          >
            {m.common_cancel()}
          </Button>
        </div>
      </form>
    </Card>
  {/if}

  <Card variant="surface" size="lg">
    {#if data.announcements.length === 0}
      <EmptyState
        variant="onboarding"
        icon={Megaphone}
        title={m.admin_announcementsEmpty()}
        description={m.admin_announcementsEmptyHint()}
      />
    {:else}
      <div class="space-y-3">
        {#each data.announcements as ann (ann.id)}
          <article class="rounded-sm border border-border-subtle bg-[color:var(--color-panel)] px-5 py-4">
            {#if editingId === ann.id}
              <!-- Edit mode -->
              <form
                class="space-y-4"
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
                <FormField label={m.admin_announcementsFieldTitle()} for="edit-title-{ann.id}" required>
                  <Input
                    id="edit-title-{ann.id}"
                    name="title"
                    value={ann.title}
                    required
                  />
                </FormField>
                <FormField
                  label={m.admin_announcementsFieldContent()}
                  hint={m.admin_announcementsMarkdownHint()}
                  for="edit-content-{ann.id}"
                  required
                >
                  <textarea
                    id="edit-content-{ann.id}"
                    class="flex min-h-32 w-full min-w-0 rounded-sm border border-input bg-background px-3 py-2 text-body shadow-rest outline-none transition-[border-color,box-shadow] duration-fast ease-out-soft placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    name="content"
                    rows="4"
                    required
                  >{ann.content}</textarea>
                </FormField>
                <div class="flex flex-wrap items-center gap-4">
                  <label class="flex items-center gap-2 text-body-sm">
                    <input type="checkbox" name="pinned" checked={ann.pinned} class="size-4" />
                    {m.admin_announcementsPinned()}
                  </label>
                  <label class="flex items-center gap-2 text-body-sm">
                    <input
                      type="checkbox"
                      name="published"
                      checked={ann.published}
                      class="size-4"
                    />
                    {m.admin_announcementsPublished()}
                  </label>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <Button type="submit" variant="default">{m.common_save()}</Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onclick={() => (editingId = null)}
                  >
                    {m.common_cancel()}
                  </Button>
                </div>
              </form>
            {:else}
              <!-- View mode -->
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h4 class="text-body-lg font-semibold">{ann.title}</h4>
                    {#if ann.pinned}
                      <Badge variant="warning" size="xs" dot>
                        {m.admin_announcementsPinned()}
                      </Badge>
                    {/if}
                    {#if ann.published}
                      <Badge variant="success" size="xs">{m.admin_announcementsPublished()}</Badge>
                    {:else}
                      <Badge variant="outline" size="xs">{m.admin_announcementsDraft()}</Badge>
                    {/if}
                  </div>
                  <p class="mt-2 text-body-sm whitespace-pre-wrap text-muted-foreground">
                    {ann.content.length > 200 ? ann.content.slice(0, 200) + "..." : ann.content}
                  </p>
                  <p class="mt-2 text-caption text-muted-foreground">
                    {m.admin_announcementsCreated()}: {new Date(ann.createdAt).toLocaleString()} &middot;
                    {m.admin_announcementsUpdated()}: {new Date(ann.updatedAt).toLocaleString()}
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <IconButton
                    label={m.common_edit()}
                    variant="ghost"
                    size="sm"
                    onclick={() => (editingId = ann.id)}
                  >
                    <Pencil class="h-4 w-4" />
                  </IconButton>
                  <form method="POST" action="?/togglePin" use:enhance>
                    <input type="hidden" name="id" value={ann.id} />
                    <IconButton
                      type="submit"
                      variant="ghost"
                      size="sm"
                      label={ann.pinned
                        ? m.admin_announcementsUnpin()
                        : m.admin_announcementsPin()}
                    >
                      {#if ann.pinned}
                        <PinOff class="h-4 w-4" />
                      {:else}
                        <Pin class="h-4 w-4" />
                      {/if}
                    </IconButton>
                  </form>
                  <form method="POST" action="?/togglePublish" use:enhance>
                    <input type="hidden" name="id" value={ann.id} />
                    <IconButton
                      type="submit"
                      variant="ghost"
                      size="sm"
                      label={ann.published
                        ? m.admin_announcementsUnpublish()
                        : m.admin_announcementsPublish()}
                    >
                      {#if ann.published}
                        <Send class="h-4 w-4" />
                      {:else}
                        <SendHorizonal class="h-4 w-4" />
                      {/if}
                    </IconButton>
                  </form>
                  <form
                    method="POST"
                    action="?/delete"
                    use:enhance={({ cancel }) => {
                      if (!confirm(m.admin_announcementsDeleteConfirm())) {
                        cancel();
                      }
                    }}
                  >
                    <input type="hidden" name="id" value={ann.id} />
                    <IconButton
                      type="submit"
                      variant="ghost"
                      size="sm"
                      label={m.common_delete()}
                      class="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 class="h-4 w-4" />
                    </IconButton>
                  </form>
                </div>
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </Card>
</Section>
