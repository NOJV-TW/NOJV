<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { toasts } from "$lib/stores/toast";

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

  const OUTPUT_SIZE = 512;
  // Preview canvas size (CSS px, also the unit we use for hit-testing).
  const VIEW_SIZE = 320;

  let fileInput: HTMLInputElement | undefined = $state();
  let dialogOpen = $state(false);
  let busy = $state(false);

  let img: HTMLImageElement | null = $state(null);
  let imgX = $state(0); // top-left of image inside view, in CSS px
  let imgY = $state(0);
  let fitScale = $state(1); // px-per-natural-px when image first fit in view
  let scale = $state(1);

  let dragging = $state(false);
  let dragStartX = 0;
  let dragStartY = 0;
  let imgStartX = 0;
  let imgStartY = 0;

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

  async function onFileChange(e: Event) {
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
      // Cover-fit so the smaller dimension fills the view.
      const fit = Math.max(VIEW_SIZE / loaded.naturalWidth, VIEW_SIZE / loaded.naturalHeight);
      fitScale = fit;
      scale = 1;
      const dispW = loaded.naturalWidth * fit;
      const dispH = loaded.naturalHeight * fit;
      imgX = (VIEW_SIZE - dispW) / 2;
      imgY = (VIEW_SIZE - dispH) / 2;
      dialogOpen = true;
    };
    loaded.onerror = () => {
      toasts.error(m.account_avatar_invalidFormat());
      URL.revokeObjectURL(url);
    };
    loaded.src = url;
  }

  function clampPosition() {
    if (!img) return;
    const dispW = img.naturalWidth * fitScale * scale;
    const dispH = img.naturalHeight * fitScale * scale;
    // Image must always cover the view, so x must be between (VIEW_SIZE - dispW) and 0.
    const minX = VIEW_SIZE - dispW;
    const minY = VIEW_SIZE - dispH;
    if (imgX > 0) imgX = 0;
    if (imgX < minX) imgX = minX;
    if (imgY > 0) imgY = 0;
    if (imgY < minY) imgY = minY;
  }

  function onPointerDown(e: PointerEvent) {
    if (!img) return;
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    imgStartX = imgX;
    imgStartY = imgY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    imgX = imgStartX + (e.clientX - dragStartX);
    imgY = imgStartY + (e.clientY - dragStartY);
    clampPosition();
  }

  function onPointerUp(e: PointerEvent) {
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  function onWheel(e: WheelEvent) {
    if (!img) return;
    e.preventDefault();
    // Zoom around view center to keep behaviour predictable.
    const factor = Math.exp(-e.deltaY * 0.0015);
    setScale(scale * factor);
  }

  function setScale(next: number) {
    if (!img) return;
    const clamped = Math.min(4, Math.max(1, next));
    // Anchor zoom on view center so the visible portion stays centered.
    const cx = VIEW_SIZE / 2;
    const cy = VIEW_SIZE / 2;
    const ratio = clamped / scale;
    imgX = cx - (cx - imgX) * ratio;
    imgY = cy - (cy - imgY) * ratio;
    scale = clamped;
    clampPosition();
  }

  function cancelDialog() {
    dialogOpen = false;
    img = null;
  }

  async function save() {
    if (!img || busy) return;
    busy = true;
    try {
      const blob = await renderCroppedBlob();
      if (!blob) {
        toasts.error(m.account_avatar_uploadFailed());
        return;
      }
      const fd = new FormData();
      fd.append("file", blob, "avatar.webp");
      const res = await fetch("/api/account/avatar", { method: "POST", body: fd });
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

  async function renderCroppedBlob(): Promise<Blob | null> {
    if (!img) return null;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Map view coords → output coords (uniform OUTPUT_SIZE/VIEW_SIZE scale).
    const k = OUTPUT_SIZE / VIEW_SIZE;
    const dispW = img.naturalWidth * fitScale * scale * k;
    const dispH = img.naturalHeight * fitScale * scale * k;
    ctx.drawImage(img, imgX * k, imgY * k, dispW, dispH);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/webp", 0.9),
    );
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

<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content showCloseButton>
    <Dialog.Header>
      <Dialog.Title>{m.account_avatar_uploadDialogTitle()}</Dialog.Title>
    </Dialog.Header>

    <div class="flex flex-col items-center gap-3">
      <div
        class="relative overflow-hidden rounded-full border border-border bg-muted"
        style:width="{VIEW_SIZE}px"
        style:height="{VIEW_SIZE}px"
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
        onwheel={onWheel}
        role="presentation"
      >
        {#if img}
          <img
            src={img.src}
            alt=""
            draggable="false"
            class="absolute select-none"
            style:left="{imgX}px"
            style:top="{imgY}px"
            style:width="{img.naturalWidth * fitScale * scale}px"
            style:height="{img.naturalHeight * fitScale * scale}px"
            style:cursor={dragging ? "grabbing" : "grab"}
          />
        {/if}
      </div>

      <p class="text-caption text-muted-foreground">{m.account_avatar_dragToMove()}</p>

      <label class="flex w-full items-center gap-3 text-caption text-muted-foreground">
        <span>{m.account_avatar_zoomLabel()}</span>
        <input
          type="range"
          min="1"
          max="4"
          step="0.01"
          value={scale}
          oninput={(e) => setScale(Number((e.currentTarget as HTMLInputElement).value))}
          class="flex-1"
        />
      </label>
    </div>

    <Dialog.Footer>
      <Button type="button" variant="outline" onclick={cancelDialog} disabled={busy}>
        {m.account_avatar_cancel()}
      </Button>
      <Button type="button" onclick={save} loading={busy}>
        {m.account_avatar_save()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
