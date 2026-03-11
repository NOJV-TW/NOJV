<script lang="ts">
  import { goto } from "$app/navigation";
  import { t } from "svelte-i18n";
  import { authClient } from "$lib/auth-client";


  let error = $state("");
  let loading = $state(false);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    loading = true;

    const form = new FormData(event.currentTarget as HTMLFormElement);
    const identity = (form.get("identity") as string).trim();
    const password = form.get("password") as string;

    const isEmail = identity.includes("@");
    const { error: signInError } = isEmail
      ? await authClient.signIn.email({ email: identity, password })
      : await authClient.signIn.username({ username: identity, password });

    loading = false;

    if (signInError) {
      error = signInError.message ?? "Invalid credentials";
      return;
    }

    goto("/");
  }
</script>

<div class="flex min-h-[60vh] items-center justify-center">
  <div
    class="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8"
  >
    <h1 class="mb-2 text-center text-2xl font-semibold">{$t("auth.adminSignIn")}</h1>
    <p class="mb-6 text-center text-xs text-[color:var(--color-muted)]">
      Handle + password login for testing
    </p>

    <form class="flex flex-col gap-4" onsubmit={handleSubmit}>
      <label class="flex flex-col gap-1 text-sm">
        Handle or Email
        <input
          autocomplete="username"
          class="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
          name="identity"
          required
          type="text"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        Password
        <input
          autocomplete="current-password"
          class="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
          name="password"
          required
          type="password"
        />
      </label>
      {#if error}
        <p class="text-sm text-red-600">{error}</p>
      {/if}
      <button
        class="rounded-lg bg-[color:var(--color-accent)] py-2 text-sm font-medium text-white disabled:opacity-50"
        disabled={loading}
        type="submit"
      >
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </form>
    <div class="mt-4 text-center">
      <a class="text-xs text-[color:var(--color-muted)] underline" href="/auth/signin">
        {$t("auth.signIn")}
      </a>
    </div>
  </div>
</div>
