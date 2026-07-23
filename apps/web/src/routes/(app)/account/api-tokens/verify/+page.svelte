<script lang="ts">
  import StepUpForm from "$lib/components/features/account/StepUpForm.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/primitives/ui/card";
  import Section from "$lib/components/primitives/ui/Section.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<PageContainer width="form">
  <Section>
    {#snippet header()}
      <h1 class="text-title-lg">{m.account_apiToken_stepUp_title()}</h1>
      <p>{m.account_apiToken_stepUp_description()}</p>
    {/snippet}

    <Card variant="surface" size="md">
      <StepUpForm
        purpose={data.purpose === "admin-mode" ? "admin-mode" : "api-tokens"}
        hasTotp={data.hasTotp}
        hasPasskey={data.hasPasskey}
        initialError={form?.error}
      />
    </Card>
  </Section>
</PageContainer>
