<script lang="ts">
  import StepUpForm from "$lib/components/features/account/StepUpForm.svelte";
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    open: boolean;
    purpose: "admin-mode" | "api-tokens";
    hasTotp: boolean;
    hasPasskey: boolean;
  }

  let { open = $bindable(false), purpose, hasTotp, hasPasskey }: Props = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Content showCloseButton class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{m.account_apiToken_stepUp_title()}</Dialog.Title>
      <Dialog.Description>
        {purpose === "admin-mode"
          ? m.account_adminMode_stepUp_description()
          : m.account_apiToken_stepUp_description()}
      </Dialog.Description>
    </Dialog.Header>

    {#if open}
      <StepUpForm {purpose} {hasTotp} {hasPasskey} />
    {/if}
  </Dialog.Content>
</Dialog.Root>
