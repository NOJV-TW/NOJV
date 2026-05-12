<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { actionErrorSchema, broadcastVerifiedSchema } from "@nojv/core";
  import { parseSchoolEmail } from "$lib/school";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Input } from "$lib/components/ui/input";
  import FormField from "$lib/components/ui/FormField.svelte";
  import * as Card from "$lib/components/ui/card";

  interface Props {
    isSchoolVerified: boolean;
  }

  let { isSchoolVerified }: Props = $props();

  type Phase = "idle" | "form" | "sent" | "verified";
  const RESEND_COOLDOWN = 60;

  let phase = $state<Phase>("idle");
  let schoolEmail = $state("");
  let error = $state("");
  let loading = $state(false);
  let cooldown = $state(0);

  $effect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => (cooldown -= 1), 1000);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (phase !== "sent") return;

    const bc = new BroadcastChannel("nojv-school-verify");
    bc.onmessage = (event: MessageEvent) => {
      if (broadcastVerifiedSchema.safeParse(event.data).success) {
        phase = "verified";
        setTimeout(() => {
          void invalidateAll();
        }, 1500);
      }
    };
    return () => bc.close();
  });

  function clientValidate(): boolean {
    error = "";
    const trimmed = schoolEmail.trim();
    if (!parseSchoolEmail(trimmed)) {
      error = m.account_invalidSchoolEmail();
      return false;
    }
    return true;
  }
</script>

<Card.Root>
  <Card.Header>
    <div class="flex items-center justify-between gap-3">
      <Card.Title class="text-title-sm">{m.account_schoolVerification()}</Card.Title>
      {#if isSchoolVerified}
        <Badge variant="success" dot>{m.account_verifiedBadge()}</Badge>
      {/if}
    </div>
    {#if !isSchoolVerified}
      <Card.Description>
        {m.account_schoolVerificationDesc()}
      </Card.Description>
    {/if}
  </Card.Header>

  {#if isSchoolVerified}
    <Card.Content>
      <p class="text-body-sm text-muted-foreground">{m.account_schoolVerified()}</p>
    </Card.Content>
  {:else}
    <Card.Content class="flex flex-col gap-3">
      {#if phase === "idle"}
        <div>
          <Button variant="outline" onclick={() => (phase = "form")}>
            {m.account_startVerification()}
          </Button>
        </div>
      {/if}

      {#if phase === "form"}
        <form
          class="flex flex-col gap-3"
          method="POST"
          action="?/sendVerification"
          use:enhance={({ cancel }) => {
            if (!clientValidate()) {
              cancel();
              return;
            }
            loading = true;
            return async ({ result, update }) => {
              loading = false;
              if (result.type === "success") {
                phase = "sent";
                cooldown = RESEND_COOLDOWN;
              } else if (result.type === "failure") {
                const parsed = actionErrorSchema.safeParse(result.data);
                error = parsed.success
                  ? parsed.data.error
                  : m.account_sendVerificationFailed();
              } else {
                await update();
              }
            };
          }}
        >
          <FormField
            label={m.account_schoolEmailLabel()}
            hint={m.account_acceptedDomains()}
            error={error}
            for="school-email"
            required
          >
            <Input
              id="school-email"
              bind:value={schoolEmail}
              name="email"
              placeholder={m.account_schoolEmailPlaceholder()}
              required
              type="email"
              aria-invalid={!!error}
            />
          </FormField>
          <div class="flex flex-wrap gap-2">
            <Button type="submit" disabled={loading} {loading}>
              {loading ? m.account_sending() : m.account_sendVerification()}
            </Button>
            <Button
              variant="ghost"
              onclick={() => {
                phase = "idle";
                error = "";
              }}
            >
              {m.common_cancel()}
            </Button>
          </div>
        </form>
      {/if}

      {#if phase === "sent"}
        <div class="flex flex-col gap-3">
          <p class="text-body-sm text-muted-foreground">{m.account_verificationSent()}</p>
          <form
            class="flex flex-wrap items-center gap-2"
            method="POST"
            action="?/sendVerification"
            use:enhance={() => {
              loading = true;
              return async ({ result, update }) => {
                loading = false;
                if (result.type === "success") {
                  cooldown = RESEND_COOLDOWN;
                } else if (result.type === "failure") {
                  const parsed = actionErrorSchema.safeParse(result.data);
                  error = parsed.success
                    ? parsed.data.error
                    : m.account_sendVerificationFailed();
                } else {
                  await update();
                }
              };
            }}
          >
            <input type="hidden" name="email" value={schoolEmail} />
            <Button variant="outline" type="submit" disabled={cooldown > 0 || loading}>
              {cooldown > 0
                ? m.account_resendCooldown({ seconds: cooldown })
                : m.account_resend()}
            </Button>
            <Button
              variant="ghost"
              onclick={() => {
                phase = "form";
                error = "";
              }}
            >
              {m.account_changeEmail()}
            </Button>
          </form>
          {#if error}
            <div
              class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-body-sm text-destructive"
              role="alert"
            >
              {error}
            </div>
          {/if}
        </div>
      {/if}

      {#if phase === "verified"}
        <Badge variant="success" dot>{m.account_verified()}</Badge>
      {/if}
    </Card.Content>
  {/if}
</Card.Root>
