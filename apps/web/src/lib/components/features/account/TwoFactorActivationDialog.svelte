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
    twoFactorEnabled: boolean;
    hasPasskey: boolean;
  }

  let { open = $bindable(false), activated, twoFactorEnabled, hasPasskey }: Props = $props();

  const hasDeviceFactor = $derived(twoFactorEnabled || hasPasskey);

  let phase = $state<"idle" | "codeSent">("idle");
  let otp = $state("");
  let code = $state("");
  let error = $state("");
  let busy = $state(false);
  let devOtp = $state("");
  let deactivateForm = $state<HTMLFormElement | null>(null);

  function reset() {
    error = "";
    otp = "";
    code = "";
    devOtp = "";
    phase = "idle";
  }

  async function verifyWithPasskey() {
    error = "";
    busy = true;
    try {
      const res = await authClient.signIn.passkey();
      if (res?.error) {
        error = res.error.message ?? m.account_passkey_verifyFailed();
        return;
      }
      deactivateForm?.requestSubmit();
    } catch {
      error = m.account_passkey_verifyFailed();
    } finally {
      busy = false;
    }
  }

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
  const btnClass =
    "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-body-sm font-medium text-primary-foreground transition-colors duration-fast ease-out-soft hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
  const secondaryBtnClass =
    "inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-body-sm font-medium transition-colors duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";
</script>

<Dialog.Root bind:open onOpenChange={(next) => next || reset()}>
  <Dialog.Content showCloseButton class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>
        {activated ? m.account_2fa_deactivate_title() : m.account_2fa_activate_title()}
      </Dialog.Title>
      <Dialog.Description>
        {activated ? m.account_2fa_deactivate_intro() : m.account_2fa_activate_intro()}
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-4">
      {#if error}
        <p class="text-caption text-destructive" role="alert">{error}</p>
      {/if}

      {#if devOtp}
        <p class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-body-sm">
          {m.account_2fa_activate_devCode()}
          <code class="font-mono font-semibold">{devOtp}</code>
        </p>
      {/if}

      {#if activated && hasDeviceFactor}
        <p class="text-body-sm text-muted-foreground">
          {m.account_2fa_deactivate_verifyHint()}
        </p>
        <form
          method="POST"
          action="?/deactivate"
          bind:this={deactivateForm}
          use:enhance={() => {
            error = "";
            busy = true;
            return async ({ result }) => {
              busy = false;
              if (result.type === "failure") {
                error =
                  (result.data?.error as string) ??
                  (result.data?.needsStepUp
                    ? m.account_2fa_needStepUp()
                    : m.account_2fa_errorGeneric());
                return;
              }
              if (result.type === "success") {
                toasts.success(m.account_2fa_deactivate_done());
                reset();
                open = false;
                await invalidateAll();
              }
            };
          }}
        >
          {#if twoFactorEnabled}
            <label class="flex flex-col gap-1.5">
              <span class="text-caption uppercase tracking-wide text-muted-foreground">
                {m.account_2fa_manageCodeLabel()}
              </span>
              <input
                name="code"
                inputmode="numeric"
                autocomplete="one-time-code"
                bind:value={code}
                class={inputClass}
              />
            </label>
          {/if}
          <div class="mt-3 flex flex-wrap gap-2">
            {#if twoFactorEnabled}
              <button type="submit" class={btnClass} disabled={busy || code.length < 6}>
                {m.account_2fa_deactivate_confirm()}
              </button>
            {/if}
            {#if hasPasskey}
              <button
                type="button"
                class={twoFactorEnabled ? secondaryBtnClass : btnClass}
                disabled={busy}
                onclick={verifyWithPasskey}
              >
                {m.account_passkey_verifyButton()}
              </button>
            {/if}
          </div>
        </form>
      {:else if phase === "idle"}
        <p class="text-body-sm text-muted-foreground">
          {activated ? m.account_2fa_deactivate_emailHint() : m.account_2fa_activate_intro()}
        </p>
        <form
          method="POST"
          action="?/sendEmailOtp"
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
                devOtp = (result.data?.devOtp as string) ?? "";
                phase = "codeSent";
                toasts.success(m.account_2fa_activate_codeSent());
              }
            };
          }}
        >
          <button type="submit" class={btnClass} disabled={busy}>
            {m.account_2fa_activate_sendCode()}
          </button>
        </form>
      {:else}
        <p class="text-body-sm text-muted-foreground">{m.account_2fa_activate_codeSent()}</p>
        <form
          class="flex flex-col gap-3"
          method="POST"
          action={activated ? "?/deactivate" : "?/activate"}
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
                toasts.success(
                  activated ? m.account_2fa_deactivate_done() : m.account_2fa_activate_done(),
                );
                reset();
                open = false;
                await invalidateAll();
              }
            };
          }}
        >
          <label class="flex flex-col gap-1.5">
            <span class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.account_2fa_activate_codeLabel()}
            </span>
            <input
              name="otp"
              inputmode="numeric"
              autocomplete="one-time-code"
              bind:value={otp}
              class={inputClass}
            />
          </label>
          <div class="flex flex-wrap gap-2">
            <button type="submit" class={btnClass} disabled={busy || otp.length < 6}>
              {activated
                ? m.account_2fa_deactivate_confirm()
                : m.account_2fa_activate_confirm()}
            </button>
            <button
              type="button"
              class={secondaryBtnClass}
              disabled={busy}
              onclick={() => {
                otp = "";
                devOtp = "";
                phase = "idle";
              }}
            >
              {m.account_2fa_activate_resend()}
            </button>
          </div>
        </form>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
