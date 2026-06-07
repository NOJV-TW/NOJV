<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto, invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { authClient } from "$lib/auth.client";
  import { actionErrorSchema, broadcastVerifiedSchema } from "@nojv/core";
  import { USERNAME_INPUT_PATTERN, isValidUsername } from "$lib/utils";
  import { isReservedUsername, parseSchoolEmail } from "$lib/utils/school";
  import { Button } from "$lib/components/primitives/ui/button";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Input } from "$lib/components/primitives/ui/input";
  import FormField from "$lib/components/primitives/ui/FormField.svelte";

  type Mode = "choose" | "school" | "general";
  const RESEND_COOLDOWN = 60;

  let mode = $state<Mode>("choose");
  let error = $state("");
  let loading = $state(false);

  let schoolEmail = $state("");
  let emailSent = $state(false);
  let cooldown = $state(0);
  let verified = $state(false);

  $effect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => (cooldown -= 1), 1000);
    return () => clearTimeout(timer);
  });

  let username = $state("");

  const POLL_INTERVAL_MS = 3000;

  $effect(() => {
    if (mode !== "school" || !emailSent || verified) return;

    const bc = new BroadcastChannel("nojv-school-verify");
    bc.onmessage = (event: MessageEvent) => {
      if (broadcastVerifiedSchema.safeParse(event.data).success) {
        verified = true;
      }
    };

    const pollId = setInterval(() => {
      void invalidateAll();
    }, POLL_INTERVAL_MS);

    return () => {
      bc.close();
      clearInterval(pollId);
    };
  });

  $effect(() => {
    if (!verified) return;
    const timer = setTimeout(async () => {
      await invalidateAll();
      await goto("/");
    }, 1500);
    return () => clearTimeout(timer);
  });

  function clientValidateSchoolEmail(): boolean {
    error = "";
    const trimmed = schoolEmail.trim();
    if (!parseSchoolEmail(trimmed)) {
      error = m.auth_invalidSchoolEmail();
      return false;
    }
    return true;
  }

  async function handleGeneralSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = "";

    const normalized = username.trim().toLowerCase();

    if (!isValidUsername(normalized)) {
      error = m.onboarding_usernamePatternError();
      return;
    }

    if (isReservedUsername(normalized)) {
      error = m.onboarding_usernameReserved();
      return;
    }

    loading = true;

    const { error: updateError } = await authClient.updateUser({
      username: normalized,
    });

    loading = false;

    if (updateError) {
      error = updateError.message ?? m.onboarding_failedToSaveUsername();
      return;
    }

    await invalidateAll();
    await goto("/");
  }

  async function handleSignOut() {
    await authClient.signOut();
    await invalidateAll();
    await goto("/");
  }
</script>

<div class="flex min-h-[60vh] items-center justify-center">
  <Card variant="elevated" size="hero" class="w-full max-w-sm">
    <div class="text-center">
      <h1 class="text-display font-semibold">{m.onboarding_title()}</h1>
    </div>

    {#if mode === "choose"}
      <div class="flex flex-col gap-3">
        <p class="text-center text-body-sm text-muted-foreground">
          {m.onboarding_subtitle()}
        </p>
        <button
          class="group rounded-sm border border-border-subtle-subtle bg-[color:var(--color-panel)] px-4 py-3 text-left shadow-rest transition-[transform,box-shadow] duration-fast ease-out-soft hover:-translate-y-px hover:shadow-hover"
          onclick={() => (mode = "school")}
          type="button"
        >
          <p class="text-body-sm font-medium">{m.onboarding_schoolOption()}</p>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.onboarding_schoolOptionDesc()}
          </p>
        </button>
        <button
          class="group rounded-sm border border-border-subtle-subtle bg-[color:var(--color-panel)] px-4 py-3 text-left shadow-rest transition-[transform,box-shadow] duration-fast ease-out-soft hover:-translate-y-px hover:shadow-hover"
          onclick={() => (mode = "general")}
          type="button"
        >
          <p class="text-body-sm font-medium">{m.onboarding_generalOption()}</p>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.onboarding_generalOptionDesc()}
          </p>
        </button>
        <Button variant="outline" size="default" onclick={() => void handleSignOut()}>
          {m.onboarding_useOtherAccount()}
        </Button>
      </div>
    {/if}

    {#if mode === "school"}
      <div>
        {#if verified}
          <p class="text-center text-body-sm font-medium text-success">
            {m.onboarding_verified()}
          </p>
        {:else}
          <form
            class="flex flex-col gap-4"
            method="POST"
            action="?/sendVerification"
            use:enhance={({ cancel }) => {
              if (!clientValidateSchoolEmail()) {
                cancel();
                return;
              }
              loading = true;
              error = "";
              return async ({ result, update }) => {
                loading = false;
                if (result.type === "success") {
                  emailSent = true;
                  cooldown = RESEND_COOLDOWN;
                } else if (result.type === "failure") {
                  const parsed = actionErrorSchema.safeParse(result.data);
                  error = parsed.success
                    ? parsed.data.error
                    : m.onboarding_failedToSendVerification();
                } else {
                  await update();
                }
              };
            }}
          >
            <FormField label={m.onboarding_schoolEmailLabel()} for="school-email" required>
              <Input
                id="school-email"
                name="email"
                oninput={(e) => (schoolEmail = (e.target as HTMLInputElement).value)}
                placeholder={m.onboarding_schoolEmailPlaceholder()}
                required
                type="email"
                value={schoolEmail}
              />
            </FormField>
            {#if emailSent && !error}
              <p class="text-body-sm text-muted-foreground">
                {m.onboarding_verificationSent()}
              </p>
            {/if}
            {#if error}
              <div
                class="rounded-sm border border-destructive/30 bg-destructive/10 p-3 text-body-sm text-destructive"
                role="alert"
              >
                {error}
              </div>
            {/if}
            <Button
              type="submit"
              variant="default"
              size="lg"
              class="w-full"
              {loading}
              disabled={loading || cooldown > 0}
            >
              {#if loading}
                {m.onboarding_sending()}
              {:else if cooldown > 0}
                {m.account_resendCooldown({ seconds: cooldown })}
              {:else if emailSent}
                {m.account_resend()}
              {:else}
                {m.onboarding_sendVerification()}
              {/if}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="default"
              onclick={() => {
                mode = "choose";
                error = "";
              }}
            >
              {m.onboarding_back()}
            </Button>
          </form>
        {/if}
      </div>
    {/if}

    {#if mode === "general"}
      <form class="flex flex-col gap-4" onsubmit={handleGeneralSubmit}>
        <FormField label={m.onboarding_usernameLabel()} for="general-username" required>
          <Input
            id="general-username"
            maxlength={64}
            oninput={(e) => (username = (e.target as HTMLInputElement).value)}
            pattern={USERNAME_INPUT_PATTERN}
            placeholder={m.onboarding_usernamePlaceholder()}
            required
            title={m.onboarding_usernamePatternHint()}
            type="text"
            value={username}
          />
        </FormField>
        {#if error}
          <div
            class="rounded-sm border border-destructive/30 bg-destructive/10 p-3 text-body-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        {/if}
        <Button
          type="submit"
          variant="default"
          size="lg"
          class="w-full"
          {loading}
          disabled={loading}
        >
          {loading ? m.onboarding_saving() : m.onboarding_continue()}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="default"
          onclick={() => {
            mode = "choose";
            error = "";
          }}
        >
          {m.onboarding_back()}
        </Button>
      </form>
    {/if}
  </Card>
</div>
