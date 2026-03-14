<script lang="ts">
  import { goto } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { authClient } from "$lib/auth-client";


  let error = $state("");
  let loading = $state(false);

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
      error = signInError.message ?? "Invalid credentials";
      return;
    }

    goto("/");
  }
</script>

<div class="flex min-h-[60vh] items-center justify-center">
  <div
    class="w-full max-w-sm rounded-[2rem] border border-border bg-[color:var(--color-panel)] p-8 backdrop-blur-sm"
  >
    <h1 class="mb-2 text-center text-2xl font-semibold">{m.auth_adminSignIn()}</h1>
    <p class="mb-6 text-center text-xs text-muted-foreground">
      {m.auth_adminDescription()}
    </p>

    <form class="flex flex-col gap-4" onsubmit={handleSubmit}>
      <label class="flex flex-col gap-1 text-sm">
        {m.auth_usernameOrEmail()}
        <input
          autocomplete="username"
          class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-3 py-3"
          name="identity"
          required
          type="text"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        {m.auth_password()}
        <input
          autocomplete="current-password"
          class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-3 py-3"
          name="password"
          required
          type="password"
        />
      </label>
      {#if error}
        <p class="text-sm text-red-600">{error}</p>
      {/if}
      <button
        class="rounded-full bg-primary py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-50"
        disabled={loading}
        type="submit"
      >
        {loading ? m.auth_signingIn() : m.auth_signIn()}
      </button>
    </form>
    <div class="mt-4 text-center">
      <a class="text-xs text-muted-foreground underline" href="/signin">
        {m.auth_signIn()}
      </a>
    </div>
  </div>
</div>
