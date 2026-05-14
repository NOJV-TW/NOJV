<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/ui/button";
  import { toasts } from "$lib/stores/toast";
  import AvatarCropperDialog from "./AvatarCropperDialog.svelte";

  interface Props {
    image: string | null;
    name: string;
  }

  let { image, name }: Props = $props();
  // Fall back to initials when the stored URL fails to load (file deleted,
  // OAuth provider rotated the URL, network error, etc.) — otherwise the
  // browser's broken-image placeholder shows up forever.
  let imageBroken = $state(false);
  $effect(() => {
    void image;
    imageBroken = false;
  });

  const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const MAX_FILE_SIZE = 5 * 1024 * 1024;

  let fileInput: HTMLInputElement | undefined = $state();
  let dialogOpen = $state(false);
  let busy = $state(false);
  let img: HTMLImageElement | null = $state(null);

  function initials(displayName: string): string {
    const trimmed = displayName.trim();
    if (!trimmed) return "?";
    const parts = trimmed.split(/\s+/).slice(0, 2);
    const joined = parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
    return joined || trimmed.charAt(0).toUpperCase() || "?";
  }

  function pickFile() {
    fileInput?.click();
  }

  function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // allow picking the same file again
    if (!file) return;

    if (!ALLOWED_TYPES.has(file.type)) {
      toasts.error(m.account_avatar_invalidFormat());
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toasts.error(m.account_avatar_tooLarge());
      return;
    }

    const url = URL.createObjectURL(file);
    const loaded = new Image();
    loaded.onload = () => {
      img = loaded;
      dialogOpen = true;
    };
    loaded.onerror = () => {
      toasts.error(m.account_avatar_invalidFormat());
      URL.revokeObjectURL(url);
    };
    loaded.src = url;
  }

  function cancelDialog() {
    dialogOpen = false;
    img = null;
  }

  async function saveCrop(blob: Blob) {
    if (busy) return;
    busy = true;
    try {
      const fd = new FormData();
      fd.append("file", blob, "avatar.webp");
      const res = await fetch("/api/account/avatar", { method: "PUT", body: fd });
      if (!res.ok) {
        toasts.error(m.account_avatar_uploadFailed());
        return;
      }
      toasts.success(m.account_avatar_uploadSuccess());
      dialogOpen = false;
      img = null;
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  async function removeAvatar() {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch("/api/account/avatar", { method: "DELETE" });
      if (!res.ok) {
        toasts.error(m.account_avatar_uploadFailed());
        return;
      }
      toasts.success(m.account_avatar_uploadSuccess());
      await invalidateAll();
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex items-center gap-4">
  <button
    type="button"
    onclick={pickFile}
    aria-label={m.account_avatar_change()}
    class="group relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-title-sm font-semibold text-muted-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
  >
    {#if image && !imageBroken}
      <img
        src={image}
        alt=""
        class="size-full object-cover"
        onerror={() => (imageBroken = true)}
      />
    {:else}
      <span aria-hidden="true">{initials(name)}</span>
    {/if}
    <span
      class="absolute inset-x-0 bottom-0 bg-black/55 py-1 text-center text-caption font-medium text-white opacity-0 transition group-hover:opacity-100"
    >
      {m.account_avatar_change()}
    </span>
  </button>

  <div class="flex flex-col gap-1.5">
    <span class="text-body-sm font-medium">{m.account_avatar_label()}</span>
    <div class="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onclick={pickFile} disabled={busy}>
        {m.account_avatar_change()}
      </Button>
      {#if image}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onclick={removeAvatar}
          disabled={busy}
        >
          {m.account_avatar_remove()}
        </Button>
      {/if}
    </div>
  </div>
</div>

<input
  bind:this={fileInput}
  type="file"
  accept="image/jpeg,image/png,image/webp"
  class="hidden"
  onchange={onFileChange}
/>

{#if img}
  <AvatarCropperDialog
    bind:open={dialogOpen}
    {img}
    {busy}
    onCancel={cancelDialog}
    onSave={saveCrop}
  />
{/if}
