<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { authClient } from "$lib/auth.client";
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";

  interface Props {
    open: boolean;
    hasPasskey: boolean;
    hasSecurityFactor: boolean;
    hasTotp: boolean;
    onUnlocked: () => void;
  }

  let {
    open = $bindable(false),
    hasPasskey,
    hasSecurityFactor,
    hasTotp,
    onUnlocked,
  }: Props = $props();

  let busy = $state(false);
  let code = $state("");
  let devOtp = $state("");
  let emailSent = $state(false);
  let error = $state("");

  function reset() {
    busy = false;
    code = "";
    devOtp = "";
    emailSent = false;
    error = "";
  }

  async function finish() {
    await invalidateAll();
    open = false;
    onUnlocked();
  }

  async function verifyWithPasskey() {
    error = "";
    busy = true;
    try {
      const result = await authClient.signIn.passkey();
      if (result?.error) {
        error = result.error.message ?? m.account_passkey_verifyFailed();
        return;
      }
      await finish();
    } catch {
      error = m.account_passkey_verifyFailed();
    } finally {
      busy = false;
    }
  }

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
  const primaryButton =
    "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-body-sm font-medium text-primary-foreground transition-colors duration-fast ease-out-soft hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
  const secondaryButton =
    "inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-body-sm font-medium transition-colors duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";
</script>

<Dialog.Root bind:open onOpenChange={(next) => next || reset()}>
  <Dialog.Content showCloseButton class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{m.account_securityUnlock_title()}</Dialog.Title>
      <Dialog.Description>
        {hasSecurityFactor
          ? m.account_securityUnlock_existingHint()
          : m.account_securityUnlock_firstHint()}
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-4">
      {#if error}
        <p class="text-body-sm text-destructive" role="alert">{error}</p>
      {/if}
      {#if devOtp}
        <p class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-body-sm">
          {m.account_emailVerification_devCode()}
          <code class="font-mono font-semibold">{devOtp}</code>
        </p>
      {/if}

      {#if hasSecurityFactor}
        {#if hasTotp}
          <form
            class="flex flex-col gap-3"
            method="POST"
            action="?/unlockSecuritySettings"
            use:enhance={() => {
              error = "";
              busy = true;
              return async ({ result }) => {
                busy = false;
                if (result.type === "failure") {
                  error = (result.data?.error as string) ?? m.account_2fa_errorGeneric();
                  return;
                }
                await finish();
              };
            }}
          >
            <label class="flex flex-col gap-1.5">
              <span class="text-caption uppercase tracking-wide text-muted-foreground">
                {m.account_securityUnlock_currentTotp()}
              </span>
              <input
                name="code"
                inputmode="numeric"
                autocomplete="one-time-code"
                bind:value={code}
                class={inputClass}
              />
            </label>
            <button type="submit" class={primaryButton} disabled={busy || code.length < 6}>
              {m.account_securityUnlock_continue()}
            </button>
          </form>
        {/if}
        {#if hasPasskey}
          <button
            type="button"
            class={hasTotp ? secondaryButton : primaryButton}
            disabled={busy}
            onclick={verifyWithPasskey}
          >
            {m.account_passkey_verifyButton()}
          </button>
        {/if}
      {:else if !emailSent}
        <form
          method="POST"
          action="?/sendSecuritySetupOtp"
          use:enhance={() => {
            error = "";
            busy = true;
            return async ({ result }) => {
              busy = false;
              if (result.type === "failure") {
                error = (result.data?.error as string) ?? m.account_2fa_errorGeneric();
                return;
              }
              if (result.type === "success") {
                emailSent = true;
                devOtp = (result.data?.devOtp as string) ?? "";
                toasts.success(m.account_emailVerification_codeSent());
              }
            };
          }}
        >
          <button type="submit" class={primaryButton} disabled={busy}>
            {m.account_emailVerification_sendCode()}
          </button>
        </form>
      {:else}
        <form
          class="flex flex-col gap-3"
          method="POST"
          action="?/unlockSecuritySettings"
          use:enhance={() => {
            error = "";
            busy = true;
            return async ({ result }) => {
              busy = false;
              if (result.type === "failure") {
                error = (result.data?.error as string) ?? m.account_2fa_errorGeneric();
                return;
              }
              await finish();
            };
          }}
        >
          <label class="flex flex-col gap-1.5">
            <span class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.account_emailVerification_codeLabel()}
            </span>
            <input
              name="otp"
              inputmode="numeric"
              autocomplete="one-time-code"
              bind:value={code}
              class={inputClass}
            />
          </label>
          <button type="submit" class={primaryButton} disabled={busy || code.length < 6}>
            {m.account_securityUnlock_continue()}
          </button>
        </form>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
