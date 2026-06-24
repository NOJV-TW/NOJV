<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { authClient } from "$lib/auth.client";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Input } from "$lib/components/primitives/ui/input";
  import FormField from "$lib/components/primitives/ui/FormField.svelte";
  import Section from "$lib/components/primitives/ui/Section.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let code = $state("");
  let submitting = $state(false);
  let passkeyError = $state("");
  let passkeyBusy = $state(false);

  async function stepUpWithPasskey() {
    passkeyError = "";
    passkeyBusy = true;
    try {
      const res = await authClient.signIn.passkey();
      if (res?.error) {
        passkeyError = res.error.message ?? "Passkey 驗證失敗。";
        return;
      }
      await goto(data.returnTo ?? "/account/api-tokens");
    } catch {
      passkeyError = "Passkey 驗證失敗。";
    } finally {
      passkeyBusy = false;
    }
  }
</script>

<PageContainer width="form">
  <Section>
    {#snippet header()}
      <h1 class="text-title-lg">{m.account_apiToken_stepUp_title()}</h1>
      <p>{m.account_apiToken_stepUp_description()}</p>
    {/snippet}

    <Card variant="surface" size="md">
      {#if form?.error}
        <p class="text-caption text-destructive" role="alert">{form.error}</p>
      {/if}

      {#if data.hasTotp}
        <form
          class="flex flex-col gap-4"
          method="POST"
          use:enhance={() => {
            submitting = true;
            return async ({ update }) => {
              await update();
              submitting = false;
            };
          }}
        >
          <input type="hidden" name="returnTo" value={data.returnTo} />
          <FormField
            label={m.account_apiToken_stepUp_codeLabel()}
            hint={m.account_apiToken_stepUp_codeHint()}
            for="api-token-stepup-code"
            required
          >
            <Input
              id="api-token-stepup-code"
              autocomplete="off"
              autocapitalize="none"
              spellcheck={false}
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

      {#if data.hasPasskey}
        <div
          class="flex flex-col gap-2 {data.hasTotp ? 'mt-4 border-t border-border pt-4' : ''}"
        >
          {#if passkeyError}
            <p class="text-caption text-destructive" role="alert">{passkeyError}</p>
          {/if}
          <Button
            type="button"
            variant={data.hasTotp ? "outline" : "default"}
            size="lg"
            class="w-full"
            loading={passkeyBusy}
            disabled={passkeyBusy}
            onclick={stepUpWithPasskey}
          >
            使用 passkey 驗證
          </Button>
        </div>
      {/if}
    </Card>
  </Section>
</PageContainer>
