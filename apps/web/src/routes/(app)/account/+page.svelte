<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import SchoolVerificationSection from "$lib/components/auth/SchoolVerification.svelte";
  import Section from "$lib/components/ui/Section.svelte";
  import { Card } from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";

  let { data } = $props();
</script>

<div class="mx-auto w-full max-w-2xl">
  <Section>
    {#snippet header()}
      <h1 class="font-display text-title-lg">{m.navigation_account()}</h1>
      <p>{m.account_profileDescription()}</p>
    {/snippet}

    <div class="flex flex-col gap-6">
      <Card variant="surface" size="md">
        <div class="flex flex-col gap-1">
          <h2 class="font-display text-title-sm">{m.account_profile()}</h2>
          <p class="text-body-sm text-muted-foreground">
            {m.account_profileHint()}
          </p>
        </div>

        <dl class="grid gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-1">
            <dt class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.account_name()}
            </dt>
            <dd class="text-body font-medium">{data.name}</dd>
          </div>
          <div class="flex flex-col gap-1">
            <dt class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.account_email()}
            </dt>
            <dd class="text-body font-medium break-all">{data.email}</dd>
          </div>
          <div class="flex flex-col gap-1">
            <dt class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.account_userAccount()}
            </dt>
            <dd class="flex items-center gap-2 text-body font-medium">
              <span>{data.username}</span>
              {#if data.isSchoolVerified}
                <Badge variant="success" size="sm" dot>
                  {m.account_verifiedBadge()}
                </Badge>
              {/if}
            </dd>
          </div>
          <div class="flex flex-col gap-1">
            <dt class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.account_role()}
            </dt>
            <dd>
              <Badge variant="muted" size="sm">{data.platformRole}</Badge>
            </dd>
          </div>
        </dl>
      </Card>

      <SchoolVerificationSection isSchoolVerified={data.isSchoolVerified} />
    </div>
  </Section>
</div>
