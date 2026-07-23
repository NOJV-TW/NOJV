<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";

  import { authClient } from "$lib/auth.client";
  import { Button } from "$lib/components/primitives/ui/button";
  import FormField from "$lib/components/primitives/ui/FormField.svelte";
  import { Input } from "$lib/components/primitives/ui/input";
  import { m } from "$lib/paraglide/messages.js";
  import { fetchWithCsrf } from "$lib/services/http";

  interface Props {
    purpose: "admin-mode" | "api-tokens";
    hasTotp: boolean;
    hasPasskey: boolean;
    initialError?: string | undefined;
  }

  let { purpose, hasTotp, hasPasskey, initialError = "" }: Props = $props();

  const componentId = $props.id();
  const inputId = `${componentId}-code`;
  let code = $state("");
  let error = $state("");
  let submitting = $state(false);
  let passkeyBusy = $state(false);

  $effect(() => {
    error = initialError;
  });

  async function stepUpWithPasskey() {
    error = "";
    passkeyBusy = true;
    try {
      const res = await authClient.signIn.passkey();
      if (res?.error) {
        error = res.error.message ?? m.account_passkey_verifyFailed();
        return;
      }
      if (purpose === "admin-mode") {
        const elevation = await fetchWithCsrf("/api/admin-mode", {
          method: "POST",
          body: JSON.stringify({ active: true }),
        });
        const result = (await elevation.json()) as { active?: boolean };
        if (!elevation.ok || result.active !== true) {
          error = m.account_passkey_verifyFailed();
          return;
        }
      } else {
        const access = await fetchWithCsrf("/api/api-token-access");
        const result = (await access.json()) as {
          setupRequired?: boolean;
          verificationRequired?: boolean;
        };
        if (
          !access.ok ||
          result.setupRequired === true ||
          result.verificationRequired !== false
        ) {
          error = m.account_passkey_verifyFailed();
          return;
        }
      }
      await goto(purpose === "admin-mode" ? "/admin" : "/account/api-tokens");
    } catch {
      error = m.account_passkey_verifyFailed();
    } finally {
      passkeyBusy = false;
    }
  }
</script>

{#if error}
  <p class="text-caption text-destructive" role="alert">{error}</p>
{/if}

{#if hasTotp}
  <form
    action="/account/api-tokens/verify"
    class="flex flex-col gap-4"
    method="POST"
    use:enhance={() => {
      error = "";
      submitting = true;
      return async ({ result }) => {
        submitting = false;
        if (result.type === "failure") {
          error = (result.data?.error as string) ?? m.account_passkey_verifyFailed();
          return;
        }
        if (result.type === "redirect") {
          await goto(result.location);
          return;
        }
        if (result.type === "error") {
          error = m.account_passkey_verifyFailed();
        }
      };
    }}
  >
    {#if purpose === "admin-mode"}
      <input type="hidden" name="purpose" value="admin-mode" />
    {/if}
    <FormField
      label={m.account_apiToken_stepUp_codeLabel()}
      hint={m.account_apiToken_stepUp_codeHint()}
      for={inputId}
      required
    >
      <Input
        id={inputId}
        autocomplete="one-time-code"
        inputmode="numeric"
        name="code"
        bind:value={code}
        required
        type="text"
      />
    </FormField>
    <Button
      type="submit"
      variant="default"
      size="lg"
      class="w-full"
      loading={submitting}
      disabled={submitting || code.length < 6}
    >
      {m.account_apiToken_stepUp_submit()}
    </Button>
  </form>
{/if}

{#if hasPasskey}
  <div class="flex flex-col gap-2 {hasTotp ? 'mt-4 border-t border-border-subtle pt-4' : ''}">
    <Button
      type="button"
      variant={hasTotp ? "outline" : "default"}
      size="lg"
      class="w-full"
      loading={passkeyBusy}
      disabled={passkeyBusy}
      onclick={stepUpWithPasskey}
    >
      {m.account_passkey_verifyButton()}
    </Button>
  </div>
{/if}
