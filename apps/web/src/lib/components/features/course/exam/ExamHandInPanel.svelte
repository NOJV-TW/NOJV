<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/primitives/ui/button";
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import GlassPanel from "$lib/components/primitives/visual/GlassPanel.svelte";
  import { m } from "$lib/paraglide/messages.js";

  let { examTitle }: { examTitle: string } = $props();
  let open = $state(false);
  let submitting = $state(false);
  let error = $state("");
  let cancelButton = $state<HTMLButtonElement | null>(null);
</script>

<GlassPanel
  class="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between"
>
  <div class="max-w-prose">
    <h2 class="text-title font-semibold">{m.examHandIn_title()}</h2>
    <p class="mt-1 text-body-sm text-muted-foreground">{m.examHandIn_hint()}</p>
  </div>
  <Button
    variant="outline"
    onclick={() => {
      error = "";
      open = true;
    }}
  >
    {m.examMode_submitEndButton()}
  </Button>
</GlassPanel>

<Dialog.Root
  {open}
  onOpenChange={(value) => {
    if (!submitting) open = value;
  }}
>
  <Dialog.Content
    showCloseButton={!submitting}
    onOpenAutoFocus={(event) => {
      event.preventDefault();
      cancelButton?.focus();
    }}
  >
    <Dialog.Header>
      <Dialog.Title>{m.examMode_submitEndConfirmTitle()}</Dialog.Title>
      <Dialog.Description>{m.examHandIn_confirm({ title: examTitle })}</Dialog.Description>
    </Dialog.Header>
    <p class="text-body-sm text-muted-foreground">{m.examHandIn_unsentWarning()}</p>
    {#if error}<p role="alert" class="text-body-sm text-destructive">{error}</p>{/if}
    <Dialog.Footer>
      <Button
        bind:ref={cancelButton}
        variant="outline"
        disabled={submitting}
        onclick={() => (open = false)}>{m.examHandIn_keepWorking()}</Button
      >
      <form
        method="POST"
        action="?/releaseSession"
        use:enhance={() => {
          submitting = true;
          error = "";
          return async ({ result, update }) => {
            submitting = false;
            if (result.type === "success" || result.type === "redirect") {
              open = false;
              await update();
            } else {
              error = m.examMode_submitEndFailed();
            }
          };
        }}
      >
        <Button type="submit" variant="destructive" loading={submitting}
          >{m.examHandIn_confirmButton()}</Button
        >
      </form>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
