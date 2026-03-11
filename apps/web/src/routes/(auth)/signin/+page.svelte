<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import OAuthButtons from "$lib/components/auth/OAuthButtons.svelte";
</script>

<div class="flex min-h-[60vh] items-center justify-center">
  <div
    class="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8"
  >
    <h1 class="mb-6 text-center text-2xl font-semibold">{m.auth_signInTitle()}</h1>

    <OAuthButtons />

    <div class="mt-6 text-center">
      <a
        class="text-xs text-[color:var(--color-muted)] underline transition hover:text-[color:var(--color-ink)]"
        href="/admin-signin"
      >
        {m.auth_adminSignIn()}
      </a>
    </div>
  </div>
</div>
