<script lang="ts">
  import { page } from "$app/stores";
  import { t } from "svelte-i18n";
  import { authClient } from "$lib/auth-client";

  let locale = $derived(($page.params as { locale: string }).locale);

  async function handleOAuth(provider: "github" | "google") {
    await authClient.signIn.social({ callbackURL: `/${locale}`, provider });
  }
</script>

<div class="flex min-h-[60vh] items-center justify-center">
  <div
    class="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8"
  >
    <h1 class="mb-6 text-center text-2xl font-semibold">{$t("auth.signInTitle")}</h1>

    <div class="flex flex-col gap-3">
      <button
        class="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--color-border)] py-2.5 text-sm font-medium transition hover:bg-white/70"
        onclick={() => void handleOAuth("github")}
        type="button"
      >
        GitHub
      </button>
      <button
        class="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--color-border)] py-2.5 text-sm font-medium transition hover:bg-white/70"
        onclick={() => void handleOAuth("google")}
        type="button"
      >
        Google
      </button>
    </div>

    <div class="mt-6 text-center">
      <a
        class="text-xs text-[color:var(--color-muted)] underline transition hover:text-[color:var(--color-ink)]"
        href="/{locale}/auth/admin-signin"
      >
        {$t("auth.adminSignIn")}
      </a>
    </div>
  </div>
</div>
