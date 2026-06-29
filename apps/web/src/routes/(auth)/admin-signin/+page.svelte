<script lang="ts">
  import { page } from "$app/state";
  import { m } from "$lib/paraglide/messages.js";
  import { authClient } from "$lib/auth.client";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { Button } from "$lib/components/primitives/ui/button";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Input } from "$lib/components/primitives/ui/input";
  import FormField from "$lib/components/primitives/ui/FormField.svelte";

  let error = $state("");
  let loading = $state(false);
  let needsTwoFactor = $state(false);
  let twoFactorCode = $state("");

  $effect(() => {
    const incomingError = page.url.searchParams.get("error");
    if (incomingError === "account-disabled") {
      error = m.auth_accountDisabled();
    }
  });

  async function completeSignIn() {
    const { data: sessionData } = await authClient.getSession();
    if (!sessionData?.session) {
      error = m.auth_sessionCookieNotPersisted();
      return;
    }
    window.location.assign("/");
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    loading = true;

    const form = new FormData(event.currentTarget as HTMLFormElement);
    const identity = String(form.get("identity") ?? "").trim();
    const password = String(form.get("password") ?? "");

    const isEmail = identity.includes("@");
    const { data: signInData, error: signInError } = isEmail
      ? await authClient.signIn.email({ email: identity, password })
      : await authClient.signIn.username({ username: identity, password });

    loading = false;

    if (signInError) {
      error = signInError.message ?? m.auth_invalidCredentials();
      return;
    }

    if (signInData && "twoFactorRedirect" in signInData && signInData.twoFactorRedirect) {
      needsTwoFactor = true;
      return;
    }

    await completeSignIn();
  }

  async function handleVerifyTwoFactor(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    loading = true;
    const { error: verifyError } = await authClient.twoFactor.verifyTotp({
      code: twoFactorCode,
    });
    loading = false;
    if (verifyError) {
      error = verifyError.message ?? m.auth_invalidCredentials();
      return;
    }
    await completeSignIn();
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

    {#if needsTwoFactor}
      <form class="flex flex-col gap-4" onsubmit={handleVerifyTwoFactor}>
        <FormField label={m.account_2fa_codeLabel()} for="admin-signin-2fa" required>
          <Input
            id="admin-signin-2fa"
            autocomplete="one-time-code"
            inputmode="numeric"
            name="twoFactorCode"
            bind:value={twoFactorCode}
            required
            type="text"
          />
        </FormField>
        <Button
          type="submit"
          variant="default"
          size="lg"
          class="w-full"
          {loading}
          disabled={loading || twoFactorCode.length < 6}
        >
          {loading ? m.auth_signingIn() : m.account_2fa_verify()}
        </Button>
      </form>
    {:else}
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
        <Button
          type="submit"
          variant="default"
          size="lg"
          class="w-full"
          {loading}
          disabled={loading}
        >
          {loading ? m.auth_signingIn() : m.auth_signIn()}
        </Button>
      </form>
    {/if}
    <div class="text-center">
      <a
        class="text-body-sm text-muted-foreground underline-offset-4 transition-colors duration-fast ease-out-soft hover:text-foreground hover:underline"
        href="/signin"
      >
        {m.auth_backToRegularSignIn()}
      </a>
    </div>
  </Card>
</div>
