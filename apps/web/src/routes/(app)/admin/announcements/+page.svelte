<script lang="ts">
  import { enhance } from "$app/forms";
  import { RadioGroup } from "bits-ui";
  import AnnouncementViewDialog from "$lib/components/announcement/AnnouncementViewDialog.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button, IconButton } from "$lib/components/ui/button";
  import { Card } from "$lib/components/ui/card";
  import PageHeader from "$lib/components/layout/PageHeader.svelte";
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

  type AnnouncementRow = (typeof data.announcements)[number];

  let editingId = $state<string | null>(null);
  let showCreateForm = $state(false);
  let viewing = $state<AnnouncementRow | null>(null);
  let viewOpen = $state(false);

  function openView(announcement: AnnouncementRow) {
    viewing = announcement;
    viewOpen = true;
  }

  type Audience = "all" | "students" | "teachers";

  const AUDIENCE_OPTIONS: { value: Audience; label: () => string }[] = [
    { value: "all", label: () => m.admin_announcement_audience_all() },
    { value: "students", label: () => m.admin_announcement_audience_students() },
    { value: "teachers", label: () => m.admin_announcement_audience_teachers() }
  ];

  function audienceBadgeVariant(audience: Audience): "muted" | "info" | "secondary" {
    if (audience === "students") return "info";
    if (audience === "teachers") return "secondary";
    return "muted";
  }

  function audienceLabel(audience: Audience) {
    if (audience === "students") return m.admin_announcement_audience_students();
    if (audience === "teachers") return m.admin_announcement_audience_teachers();
    return m.admin_announcement_audience_all();
  }

  /** Format an ISO date string for `<input type="datetime-local">` (local-tz, minute resolution). */
  function toLocalInput(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
</script>

{#snippet announcementsActions()}
  <Badge variant="muted" size="sm">{data.announcements.length}</Badge>
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

<PageHeader
  eyebrow={m.admin_eyebrow()}
  title={m.admin_announcementsTitle()}
  description={m.admin_announcementsSubtitle()}
  actions={announcementsActions}
/>

<div class="space-y-6">

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
        <FormField label={m.admin_announcement_audience_label()} for="create-audience-all">
          <RadioGroup.Root
            name="audience"
            value="all"
            class="flex flex-wrap gap-3"
            orientation="horizontal"
          >
            {#each AUDIENCE_OPTIONS as opt (opt.value)}
              <label class="flex items-center gap-2 text-body-sm">
                <RadioGroup.Item
                  id="create-audience-{opt.value}"
                  value={opt.value}
                  class="grid size-4 place-items-center rounded-full border border-input data-[state=checked]:border-primary"
                >
                  {#snippet children({ checked })}
                    {#if checked}
                      <span class="size-2 rounded-full bg-primary"></span>
                    {/if}
                  {/snippet}
                </RadioGroup.Item>
                {opt.label()}
              </label>
            {/each}
          </RadioGroup.Root>
        </FormField>
        <FormField
          label={m.admin_announcement_expiresAt_label()}
          hint={m.admin_announcement_expiresAt_helper()}
          for="create-expiresAt"
        >
          <Input id="create-expiresAt" type="datetime-local" name="expiresAt" />
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
                <FormField
                  label={m.admin_announcement_audience_label()}
                  for="edit-audience-{ann.id}-all"
                >
                  <RadioGroup.Root
                    name="audience"
                    value={ann.audience}
                    class="flex flex-wrap gap-3"
                    orientation="horizontal"
                  >
                    {#each AUDIENCE_OPTIONS as opt (opt.value)}
                      <label class="flex items-center gap-2 text-body-sm">
                        <RadioGroup.Item
                          id="edit-audience-{ann.id}-{opt.value}"
                          value={opt.value}
                          class="grid size-4 place-items-center rounded-full border border-input data-[state=checked]:border-primary"
                        >
                          {#snippet children({ checked })}
                            {#if checked}
                              <span class="size-2 rounded-full bg-primary"></span>
                            {/if}
                          {/snippet}
                        </RadioGroup.Item>
                        {opt.label()}
                      </label>
                    {/each}
                  </RadioGroup.Root>
                </FormField>
                <FormField
                  label={m.admin_announcement_expiresAt_label()}
                  hint={m.admin_announcement_expiresAt_helper()}
                  for="edit-expiresAt-{ann.id}"
                >
                  <Input
                    id="edit-expiresAt-{ann.id}"
                    type="datetime-local"
                    name="expiresAt"
                    value={toLocalInput(ann.expiresAt)}
                  />
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
              <div
                class="flex cursor-pointer items-start justify-between gap-4 rounded-sm transition-colors duration-fast ease-out-soft hover:bg-accent/40"
                onclick={() => openView(ann)}
                onkeydown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openView(ann);
                  }
                }}
                role="button"
                tabindex="0"
              >
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h4 class="flex items-center gap-1.5 text-body-lg font-semibold">
                      {#if ann.pinned}
                        <Pin
                          class="size-3.5 shrink-0 text-warning"
                          aria-label={m.admin_announcementsPinned()}
                        />
                      {/if}
                      <span class="truncate">{ann.title}</span>
                    </h4>
                    {#if ann.published}
                      <Badge variant="success" size="xs">{m.admin_announcementsPublished()}</Badge>
                    {:else}
                      <Badge variant="outline" size="xs">{m.admin_announcementsDraft()}</Badge>
                    {/if}
                    <Badge variant={audienceBadgeVariant(ann.audience)} size="xs">
                      {audienceLabel(ann.audience)}
                    </Badge>
                  </div>
                  <p class="mt-2 line-clamp-2 text-body-sm text-muted-foreground">
                    {ann.content}
                  </p>
                  <p class="mt-2 text-caption text-muted-foreground">
                    {m.admin_announcementsCreated()}: {new Date(ann.createdAt).toLocaleString()} &middot;
                    {m.admin_announcementsUpdated()}: {new Date(ann.updatedAt).toLocaleString()}
                    {#if ann.expiresAt}
                      &middot;
                      {m.admin_announcement_expired_at()}: {new Date(ann.expiresAt).toLocaleString()}
                    {/if}
                  </p>
                </div>
                <div
                  class="flex shrink-0 items-center gap-1"
                  onclick={(e) => e.stopPropagation()}
                  role="presentation"
                >
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
</div>

<AnnouncementViewDialog bind:open={viewOpen} announcement={viewing} />
