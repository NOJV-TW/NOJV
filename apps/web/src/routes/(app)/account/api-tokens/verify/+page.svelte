<script lang="ts">
  import { enhance } from "$app/forms";
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
          {m.account_2fa_verify()}
        </Button>
      </form>
    </Card>
  </Section>
</PageContainer>
