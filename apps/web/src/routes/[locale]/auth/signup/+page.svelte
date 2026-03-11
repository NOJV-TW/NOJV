<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { t } from "svelte-i18n";
  import { authClient } from "$lib/auth-client";

  let locale = $derived(($page.params as { locale: string }).locale);
  let error = $state("");
  let loading = $state(false);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    loading = true;

    const form = new FormData(event.currentTarget as HTMLFormElement);

    const { error: signUpError } = await authClient.signUp.email({
      email: form.get("email") as string,
      name: form.get("displayName") as string,
      password: form.get("password") as string,
      username: form.get("handle") as string
    });

    loading = false;

    if (signUpError) {
      error = signUpError.message ?? "Registration failed.";
      return;
    }

    goto(`/${locale}`);
  }

  async function handleOAuth(provider: "github" | "google") {
    await authClient.signIn.social({ callbackURL: `/${locale}`, provider });
  }
</script>

<div class="flex min-h-[60vh] items-center justify-center">
  <div
    class="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8"
  >
    <h1 class="mb-6 text-center text-2xl font-semibold">Create your NOJV account</h1>

    <div class="flex flex-col gap-3">
      <button
        class="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
        onclick={() => void handleOAuth("github")}
        type="button"
      >
        GitHub
      </button>
      <button
        class="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
        onclick={() => void handleOAuth("google")}
        type="button"
      >
        Google
      </button>
    </div>

    <div class="my-5 flex items-center gap-3 text-xs text-[color:var(--color-muted)]">
      <hr class="flex-1 border-[color:var(--color-border)]" />
      or
      <hr class="flex-1 border-[color:var(--color-border)]" />
    </div>

    <form class="flex flex-col gap-4" onsubmit={handleSubmit}>
      <label class="flex flex-col gap-1 text-sm">
        Display name
        <input
          class="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
          name="displayName"
          required
          type="text"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        Handle
        <input
          class="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
          name="handle"
          pattern="[a-z0-9._-]{3,64}"
          required
          title="3-64 characters, lowercase letters, digits, dots, hyphens, underscores"
          type="text"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        Email
        <input
          autocomplete="email"
          class="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
          name="email"
          required
          type="email"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        Password
        <input
          autocomplete="new-password"
          class="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
          minlength={8}
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
        {loading ? "Creating account..." : "Sign up"}
      </button>
    </form>
    <p class="mt-4 text-center text-sm text-[color:var(--color-muted)]">
      Already have an account?{" "}
      <a class="text-[color:var(--color-accent)] underline" href="/{locale}/auth/signin">
        Sign in
      </a>
    </p>
  </div>
</div>
