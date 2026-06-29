<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import { Button } from "$lib/components/primitives/ui/button";

  interface Props {
    open: boolean;
    img: HTMLImageElement;
    busy: boolean;
    onCancel: () => void;
    onSave: (blob: Blob) => void | Promise<void>;
  }

  let { open = $bindable(), img, busy, onCancel, onSave }: Props = $props();

  const OUTPUT_SIZE = 512;
  const VIEW_SIZE = 320;

  const fitScale = $derived(
    Math.max(VIEW_SIZE / img.naturalWidth, VIEW_SIZE / img.naturalHeight),
  );

  let scale = $state(1);
  let imgX = $state(0);
  let imgY = $state(0);

  $effect(() => {
    imgX = (VIEW_SIZE - img.naturalWidth * fitScale) / 2;
    imgY = (VIEW_SIZE - img.naturalHeight * fitScale) / 2;
  });

  let dragging = $state(false);
  let dragStartX = 0;
  let dragStartY = 0;
  let imgStartX = 0;
  let imgStartY = 0;

  function clampPosition() {
    const dispW = img.naturalWidth * fitScale * scale;
    const dispH = img.naturalHeight * fitScale * scale;
    const minX = VIEW_SIZE - dispW;
    const minY = VIEW_SIZE - dispH;
    if (imgX > 0) imgX = 0;
    if (imgX < minX) imgX = minX;
    if (imgY > 0) imgY = 0;
    if (imgY < minY) imgY = minY;
  }

  function onPointerDown(e: PointerEvent) {
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
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    setScale(scale * factor);
  }

  function setScale(next: number) {
    const clamped = Math.min(4, Math.max(1, next));
    const cx = VIEW_SIZE / 2;
    const cy = VIEW_SIZE / 2;
    const ratio = clamped / scale;
    imgX = cx - (cx - imgX) * ratio;
    imgY = cy - (cy - imgY) * ratio;
    scale = clamped;
    clampPosition();
  }

  async function renderCroppedBlob(): Promise<Blob | null> {
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const k = OUTPUT_SIZE / VIEW_SIZE;
    const dispW = img.naturalWidth * fitScale * scale * k;
    const dispH = img.naturalHeight * fitScale * scale * k;
    ctx.drawImage(img, imgX * k, imgY * k, dispW, dispH);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/webp", 0.9),
    );
  }

  async function handleSave() {
    const blob = await renderCroppedBlob();
    if (!blob) return;
    await onSave(blob);
  }
</script>

<Dialog.Root bind:open>
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
        <img
          src={img.src}
          alt=""
          draggable="false"
          class="absolute max-w-none select-none"
          style:left="{imgX}px"
          style:top="{imgY}px"
          style:width="{img.naturalWidth * fitScale * scale}px"
          style:height="{img.naturalHeight * fitScale * scale}px"
          style:cursor={dragging ? "grabbing" : "grab"}
        />
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
      <Button type="button" variant="outline" onclick={onCancel} disabled={busy}>
        {m.account_avatar_cancel()}
      </Button>
      <Button type="button" onclick={handleSave} loading={busy}>
        {m.account_avatar_save()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
