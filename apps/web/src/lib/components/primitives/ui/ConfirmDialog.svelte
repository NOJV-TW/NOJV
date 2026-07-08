<script lang="ts">
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import { Button } from "$lib/components/primitives/ui/button";
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
      <Button variant="outline" onclick={() => oncancel?.()}>
        {cancelText}
      </Button>
      <Button
        variant={variant === "danger" ? "destructive" : "default"}
        onclick={() => onconfirm?.()}
      >
        {confirmText}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
