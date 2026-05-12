<script lang="ts">
  import { untrack } from "svelte";
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Input } from "$lib/components/ui/input";
  import FormField from "$lib/components/ui/FormField.svelte";
  import ImageDropZone from "$lib/components/ui/ImageDropZone.svelte";

  interface AnnouncementInitial {
    id: string;
    title: string;
    content: string;
    pinned: boolean;
    expiresAt: string | null;
  }

  interface Props {
    open: boolean;
    mode: "create" | "edit";
    initial?: AnnouncementInitial | null;
    onclose?: () => void;
  }

  let { open = $bindable(false), mode, initial = null, onclose }: Props = $props();

  function toLocalInput(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  let submitting = $state(false);
  let content = $state(untrack(() => initial?.content ?? ""));
  const action = $derived(mode === "create" ? "?/createAnnouncement" : "?/updateAnnouncement");

  $effect(() => {
    // Re-seed `content` when the dialog reopens with different initial data
    // (mode flip or selecting a different announcement to edit). Writes to
    // $state inside $effect don't subscribe, so the in-progress edits don't
    // trigger a self-overwriting loop.
    content = initial?.content ?? "";
  });
</script>

<Dialog.Root bind:open>
  <Dialog.Content showCloseButton class="max-w-xl">
    <Dialog.Header>
      <Dialog.Title>
        {mode === "create"
          ? m.courseOverview_newAnnouncement()
          : m.courseOverview_editAnnouncement()}
      </Dialog.Title>
    </Dialog.Header>

    <form
      class="space-y-4"
      method="POST"
      {action}
      use:enhance={() => {
        submitting = true;
        return async ({ result }) => {
          submitting = false;
          if (result.type === "success" || result.type === "redirect") {
            await invalidateAll();
            open = false;
            onclose?.();
          }
        };
      }}
    >
      {#if mode === "edit" && initial}
        <input type="hidden" name="id" value={initial.id} />
      {/if}

      <FormField label={m.admin_announcementsFieldTitle()} for="ann-title" required>
        <Input
          id="ann-title"
          name="title"
          placeholder={m.admin_announcementsFieldTitle()}
          required
          value={initial?.title ?? ""}
        />
      </FormField>

      <FormField
        label={m.admin_announcementsFieldContent()}
        hint={m.admin_announcementsMarkdownHint()}
        for="ann-content"
        required
      >
        <ImageDropZone
          id="ann-content"
          name="content"
          required
          class="flex min-h-32 w-full min-w-0 rounded-sm border border-input bg-background px-3 py-2 text-body shadow-rest outline-none transition-[border-color,box-shadow] duration-fast ease-out-soft placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          placeholder={m.admin_announcementsFieldContent()}
          bind:value={content}
        />
      </FormField>

      <FormField
        label={m.admin_announcement_expiresAt_label()}
        hint={m.admin_announcement_expiresAt_helper()}
        for="ann-expires"
      >
        <Input
          id="ann-expires"
          name="expiresAt"
          type="datetime-local"
          value={toLocalInput(initial?.expiresAt ?? null)}
        />
      </FormField>

      {#if mode === "edit" && initial}
        <input type="hidden" name="pinned" value={initial.pinned ? "on" : ""} />
      {/if}

      <Dialog.Footer>
        <button
          type="button"
          class="inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-sm font-medium transition hover:bg-muted"
          onclick={() => {
            open = false;
            onclose?.();
          }}
          disabled={submitting}
        >
          {m.admin_cancel()}
        </button>
        <button
          type="submit"
          class="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={submitting}
        >
          {submitting
            ? m.common_saving()
            : mode === "create"
              ? m.admin_announcementsCreate()
              : m.common_save()}
        </button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
