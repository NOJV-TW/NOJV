<script lang="ts">
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    open: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onconfirm?: () => void;
    oncancel?: () => void;
    variant?: "default" | "danger";
  }

  let {
    open = $bindable(false),
    title,
    message,
    confirmText = m.common_confirm(),
    cancelText = m.common_cancel(),
    onconfirm,
    oncancel,
    variant = "default",
  }: Props = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Content showCloseButton>
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
    </Dialog.Header>
    <p class="text-sm text-muted-foreground">{message}</p>
    <Dialog.Footer>
      <button
        class="inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-sm font-medium transition hover:bg-muted"
        type="button"
        onclick={() => oncancel?.()}
      >
        {cancelText}
      </button>
      <button
        class="inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 {variant === 'danger' ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary hover:bg-primary/90'}"
        type="button"
        onclick={() => onconfirm?.()}
      >
        {confirmText}
      </button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
