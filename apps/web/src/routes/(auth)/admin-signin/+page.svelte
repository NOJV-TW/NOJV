<script lang="ts">
  import { page } from "$app/stores";
  import { m } from "$lib/paraglide/messages.js";
  import { authClient } from "$lib/auth-client";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import FormField from "$lib/components/ui/FormField.svelte";

  let error = $state("");
  let loading = $state(false);

  $effect(() => {
    const incomingError = $page.url.searchParams.get("error");
    if (incomingError === "account-disabled") {
      error = m.auth_accountDisabled();
    }
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    loading = true;

    const form = new FormData(event.currentTarget as HTMLFormElement);
    const identity = String(form.get("identity") ?? "").trim();
    const password = String(form.get("password") ?? "");

    const isEmail = identity.includes("@");
    const { error: signInError } = isEmail
      ? await authClient.signIn.email({ email: identity, password })
      : await authClient.signIn.username({ username: identity, password });

    loading = false;

    if (signInError) {
      error = signInError.message ?? m.auth_invalidCredentials();
      return;
    }

    // Confirm cookie/session is actually persisted before leaving sign-in page.
    const { data: sessionData } = await authClient.getSession();
    if (!sessionData?.session) {
      error = m.auth_sessionCookieNotPersisted();
      return;
    }

    window.location.assign("/");
  }
</script>

<div class="flex min-h-[60vh] items-center justify-center">
  <Card variant="elevated" size="hero" class="w-full max-w-sm">
    <div class="text-center">
      <div class="inline-flex items-center justify-center gap-3">
        <h1 class="text-title-lg font-semibold">
          {m.auth_adminSignIn()}
        </h1>
        <Badge variant="outline" size="sm">{m.auth_adminBadge()}</Badge>
      </div>
      <p class="mt-2 text-body-sm text-muted-foreground">
        {m.auth_adminDescription()}
      </p>
    </div>

    {#if error}
      <div
        class="rounded-sm border border-destructive/30 bg-destructive/10 p-3 text-body-sm text-destructive"
        role="alert"
      >
        {error}
      </div>
    {/if}

    <form class="flex flex-col gap-4" onsubmit={handleSubmit}>
      <FormField label={m.auth_usernameOrEmail()} for="admin-signin-identity" required>
        <Input
          id="admin-signin-identity"
          autocomplete="username"
          name="identity"
          required
          type="text"
        />
      </FormField>
      <FormField label={m.auth_password()} for="admin-signin-password" required>
        <Input
          id="admin-signin-password"
          autocomplete="current-password"
          name="password"
          required
          type="password"
        />
      </FormField>
      <Button type="submit" variant="default" size="lg" class="w-full" {loading} disabled={loading}>
        {loading ? m.auth_signingIn() : m.auth_signIn()}
      </Button>
    </form>
    <div class="text-center">
      <a
        class="text-body-sm text-muted-foreground underline-offset-4 transition-colors duration-fast ease-out-soft hover:text-foreground hover:underline"
        href="/signin"
      >
        {m.auth_signIn()}
      </a>
    </div>
  </Card>
</div>
