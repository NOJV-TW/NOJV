<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";
  import { fetchWithCsrf } from "$lib/services/http";
  import AvatarCropperDialog from "./AvatarCropperDialog.svelte";

  interface Props {
    image: string | null;
    name: string;
  }

  let { image, name }: Props = $props();
  let imageBroken = $state(false);
  let imgEl: HTMLImageElement | undefined = $state();
  $effect(() => {
    void image;
    imageBroken = false;
  });
  $effect(() => {
    if (imgEl?.complete && imgEl.naturalWidth === 0) {
      imageBroken = true;
    }
  });

  const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const MAX_FILE_SIZE = 5 * 1024 * 1024;

  let fileInput: HTMLInputElement | undefined = $state();
  let dialogOpen = $state(false);
  let busy = $state(false);
  let img: HTMLImageElement | null = $state(null);

  function initials(displayName: string): string {
    return displayName.trim().charAt(0).toUpperCase() || "?";
  }

  function pickFile() {
    fileInput?.click();
  }

  async function uploadErrorMessage(res: Response): Promise<string> {
    if (res.status === 429) return m.account_avatar_uploadFailed();
    const data = (await res.json().catch(() => null)) as { message?: unknown } | null;
    if (typeof data?.message === "string" && data.message.length > 0) return data.message;
    return m.account_avatar_uploadFailed();
  }

  function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
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
      if (blob.type !== "image/webp") {
        toasts.error(m.account_avatar_invalidFormat());
        return;
      }
      const fd = new FormData();
      fd.append("file", blob, "avatar.webp");
      const res = await fetchWithCsrf("/api/account/avatar", { method: "PUT", body: fd });
      if (!res.ok) {
        toasts.error(await uploadErrorMessage(res));
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
      const res = await fetchWithCsrf("/api/account/avatar", { method: "DELETE" });
      if (!res.ok) {
        toasts.error(await uploadErrorMessage(res));
        return;
      }
      toasts.success(m.account_avatar_uploadSuccess());
      await invalidateAll();
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex shrink-0 flex-col items-center gap-1">
  <button
    type="button"
    onclick={pickFile}
    aria-label={m.account_avatar_change()}
    class="group relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-primary text-title font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
  >
    {#if image && !imageBroken}
      <img
        bind:this={imgEl}
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

  {#if image}
    <button
      type="button"
      class="text-caption text-muted-foreground transition-colors duration-fast ease-out-soft hover:text-foreground disabled:opacity-50"
      onclick={removeAvatar}
      disabled={busy}
    >
      {m.account_avatar_remove()}
    </button>
  {/if}
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
