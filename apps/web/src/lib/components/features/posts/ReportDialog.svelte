<script lang="ts">
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import { Button } from "$lib/components/primitives/ui/button";
  import { m } from "$lib/paraglide/messages.js";
  import { fetchWithCsrf } from "$lib/services/http";
  import { toasts } from "$lib/stores/toast";

  interface Props {
    open: boolean;
    endpoint: string;
  }

  let { open = $bindable(false), endpoint }: Props = $props();

  let reason = $state("");
  let submitting = $state(false);
  let alreadyReported = $state(false);

  $effect(() => {
    if (open) {
      reason = "";
      alreadyReported = false;
    }
  });

  async function submit() {
    if (submitting || reason.trim().length === 0) return;
    submitting = true;
    try {
      const res = await fetchWithCsrf(endpoint, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (res.status === 201) {
        toasts.success(m.posts_reportSuccess());
        open = false;
      } else if (res.status === 409) {
        alreadyReported = true;
      } else {
        const body = await res.json().catch(() => null);
        toasts.error(body?.message ?? m.posts_reportError());
      }
    } catch {
      toasts.error(m.posts_reportError());
    } finally {
      submitting = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showCloseButton>
    <Dialog.Header>
      <Dialog.Title>{m.posts_reportTitle()}</Dialog.Title>
    </Dialog.Header>
    <textarea
      class="w-full rounded-md border border-border bg-background px-3 py-2 text-body-sm leading-6"
      rows="4"
      maxlength="1000"
      placeholder={m.posts_reportReasonPlaceholder()}
      bind:value={reason}></textarea>
    {#if alreadyReported}
      <p class="text-caption text-destructive" role="alert">{m.posts_reportAlready()}</p>
    {/if}
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>
        {m.common_cancel()}
      </Button>
      <Button
        variant="destructive"
        disabled={submitting || reason.trim().length === 0}
        onclick={submit}
      >
        {submitting ? m.posts_reportSubmitting() : m.posts_reportSubmit()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
