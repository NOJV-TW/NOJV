<script lang="ts">
  import { deserialize } from "$app/forms";
  import { goto, invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { authClient } from "$lib/auth.client";
  import { actionErrorSchema } from "@nojv/core";
  import { USERNAME_INPUT_PATTERN, isValidUsername } from "$lib/utils";
  import { isReservedUsername } from "$lib/utils/school";
  import { Button } from "$lib/components/primitives/ui/button";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Input } from "$lib/components/primitives/ui/input";
  import FormField from "$lib/components/primitives/ui/FormField.svelte";

  let error = $state("");
  let loading = $state(false);
  let username = $state("");

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

    try {
      const body = new FormData();
      body.set("username", normalized);
      const response = await fetch("?/setUsername", {
        method: "POST",
        body,
        headers: { accept: "application/json", "x-sveltekit-action": "true" },
      });
      const result = deserialize(await response.text());
      if (result.type !== "success") {
        const parsed =
          result.type === "failure" ? actionErrorSchema.safeParse(result.data) : null;
        const code = parsed?.success ? parsed.data.error : "";
        const messages: Record<string, string> = {
          TAKEN: m.account_usernameTaken(),
          VERIFIED_LOCKED: m.account_usernameLockedByVerification(),
          RESERVED_FORMAT: m.onboarding_usernameReserved(),
          INVALID_FORMAT: m.onboarding_usernamePatternError(),
        };
        error = messages[code] ?? (code || m.onboarding_failedToSaveUsername());
        return;
      }
    } catch {
      error = m.onboarding_failedToSaveUsername();
      return;
    } finally {
      loading = false;
    }

    await invalidateAll();
    await goto("/dashboard");
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

    <p class="text-center text-body-sm text-muted-foreground">
      {m.onboarding_subtitle()}
    </p>

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
    </form>
    <Button variant="outline" size="default" onclick={() => void handleSignOut()}>
      {m.onboarding_useOtherAccount()}
    </Button>
  </Card>
</div>
