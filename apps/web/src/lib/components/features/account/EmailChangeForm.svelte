<script lang="ts">
  import { goto } from "$app/navigation";
  import { enhance as enhanceAction } from "$app/forms";
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";

  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";
  import type { FormMessage } from "$lib/types/form-message";
  import FormField from "$lib/components/primitives/ui/FormField.svelte";
  import { Input } from "$lib/components/primitives/ui/input";
  import { Button } from "$lib/components/primitives/ui/button";
  import type { ChangeEmailData } from "$lib/../routes/(app)/settings/email-schema";

  interface Props {
    currentEmail: string;
    data: SuperValidated<ChangeEmailData, FormMessage>;
    emailVerified: boolean;
    verificationError: "invalidToken" | "tokenExpired" | null;
  }

  let { currentEmail, data, emailVerified, verificationError }: Props = $props();
  let editing = $state(false);
  let callbackError = $state<"invalidToken" | "tokenExpired" | null>(
    untrack(() => verificationError),
  );
  let resendBusy = $state(false);
  let resendError = $state(false);

  const { form, errors, enhance, message, submitting } = superForm<
    ChangeEmailData,
    FormMessage
  >(
    untrack(() => data),
    {
      resetForm: false,
      taintedMessage: null,
      onUpdated({ form }) {
        if (form.message?.kind === "success") {
          toasts.success(
            emailVerified
              ? m.account_emailChange_verificationSent()
              : m.account_emailChange_verificationSentUnverified(),
          );
          editing = false;
        }
      },
    },
  );

  const inputClass = "w-full";
  const emailError = $derived($errors.newEmail ? m.account_emailChange_invalid() : undefined);
  const formError = $derived(
    $message?.kind === "error" ? m.account_emailChange_failed() : undefined,
  );
  const callbackErrorText = $derived(
    callbackError === "invalidToken"
      ? m.account_emailVerification_invalidToken()
      : callbackError === "tokenExpired"
        ? m.account_emailVerification_tokenExpired()
        : undefined,
  );

  function startEditing() {
    $form.newEmail = "";
    callbackError = null;
    resendError = false;
    editing = true;
  }
</script>

<div class="flex flex-col gap-3">
  {#if callbackErrorText}
    <div
      class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3"
      role="alert"
    >
      <p class="text-body-sm text-destructive">{callbackErrorText}</p>
      {#if emailVerified}
        <Button variant="outline" size="sm" onclick={startEditing}>
          {m.account_emailVerification_retryChange()}
        </Button>
      {:else}
        <form
          method="POST"
          action="?/resendEmailVerification"
          use:enhanceAction={() => {
            resendBusy = true;
            resendError = false;
            return async ({ result }) => {
              resendBusy = false;
              if (result.type === "success") {
                resendError = false;
                callbackError = null;
                toasts.success(m.account_emailVerification_resendSuccess());
                await goto("/settings", { replaceState: true, invalidateAll: true });
              } else if (result.type === "failure") {
                resendError = true;
              }
            };
          }}
        >
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={resendBusy}
            loading={resendBusy}
          >
            {m.account_emailVerification_resend()}
          </Button>
        </form>
      {/if}
      {#if resendError}
        <p class="basis-full text-caption text-destructive">
          {m.account_emailVerification_resendFailed()}
        </p>
      {/if}
    </div>
  {/if}

  <div class="flex items-start justify-between gap-4 rounded-md border border-border px-4 py-3">
    <div class="flex min-w-0 flex-col gap-1">
      <span class="text-caption uppercase tracking-wide text-muted-foreground">
        {m.account_email()}
      </span>
      <span class="text-body font-medium break-all">{currentEmail}</span>
    </div>
    {#if !editing}
      <Button variant="outline" size="sm" onclick={startEditing}>
        {m.account_changeEmail()}
      </Button>
    {/if}
  </div>

  {#if editing}
    <form method="POST" action="?/changeEmail" use:enhance class="flex flex-col gap-3">
      <FormField
        label={m.account_emailChange_newEmail()}
        hint={m.account_emailChange_description()}
        error={emailError ?? ""}
        for="change-email"
        required
      >
        <Input
          id="change-email"
          name="newEmail"
          type="email"
          autocomplete="email"
          bind:value={$form.newEmail}
          aria-invalid={$errors.newEmail ? "true" : undefined}
          class={inputClass}
          required
        />
      </FormField>

      {#if formError}
        <p class="text-caption text-destructive" role="alert">{formError}</p>
      {/if}

      <div class="flex flex-wrap gap-2">
        <Button type="submit" disabled={$submitting} loading={$submitting}>
          {m.account_emailChange_submit()}
        </Button>
        <Button variant="ghost" type="button" onclick={() => (editing = false)}>
          {m.common_cancel()}
        </Button>
      </div>
    </form>
  {/if}
</div>
