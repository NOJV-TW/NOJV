<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { authClient } from "$lib/auth.client";
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";

  interface Props {
    open: boolean;
    activated: boolean;
    passkeys: { id: string; name: string }[];
  }

  let { open = $bindable(false), activated, passkeys }: Props = $props();

  let busy = $state(false);
  let error = $state("");
  const steppedUp = new Set<string>();

  async function addPasskey() {
    error = "";
    busy = true;
    try {
      const res = await authClient.passkey.addPasskey({
        name: `Passkey ${passkeys.length + 1}`,
      });
      if (res?.error) {
        error = res.error.message ?? m.account_passkey_addError();
        return;
      }
      toasts.success(m.account_passkey_addSuccess());
      await invalidateAll();
    } catch {
      error = m.account_passkey_addError();
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showCloseButton class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Passkey</Dialog.Title>
      <Dialog.Description>{m.account_passkey_description()}</Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-3">
      {#if error}
        <p class="text-caption text-destructive" role="alert">{error}</p>
      {/if}
      {#if !activated}
        <p class="text-body-sm text-muted-foreground">{m.account_2fa_methodsLockedHint()}</p>
      {/if}
      {#each passkeys as passkey (passkey.id)}
        <div
          class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3"
        >
          <span class="text-body-sm font-medium">{passkey.name}</span>
          <form
            method="POST"
            action="?/deletePasskey"
            use:enhance={({ formElement }) => {
              error = "";
              busy = true;
              return async ({ result }) => {
                busy = false;
                if (result.type === "failure") {
                  if (result.data?.needsStepUp && !steppedUp.has(passkey.id)) {
                    const res = await authClient.signIn.passkey();
                    if (res?.error) {
                      error = res.error.message ?? m.account_passkey_verifyFailed();
                      return;
                    }
                    steppedUp.add(passkey.id);
                    formElement.requestSubmit();
                    return;
                  }
                  error = (result.data?.error as string) ?? m.account_passkey_verifyFailed();
                  return;
                }
                steppedUp.delete(passkey.id);
                toasts.success(m.account_passkey_removeSuccess());
                await invalidateAll();
              };
            }}
          >
            <input type="hidden" name="id" value={passkey.id} />
            <button
              type="submit"
              disabled={busy}
              class="rounded-md border border-destructive/40 px-3 py-1.5 text-caption font-medium text-destructive disabled:cursor-not-allowed disabled:opacity-50"
            >
              {m.account_passkey_remove()}
            </button>
          </form>
        </div>
      {/each}
      <button
        type="button"
        onclick={addPasskey}
        disabled={busy || !activated}
        title={activated ? undefined : m.account_2fa_methodsLockedHint()}
        class="self-start rounded-md border border-border px-3 py-1.5 text-caption font-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {m.account_passkey_add()}
      </button>
    </div>
  </Dialog.Content>
</Dialog.Root>
