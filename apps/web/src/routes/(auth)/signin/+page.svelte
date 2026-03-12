<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import OAuthButtons from "$lib/components/auth/OAuthButtons.svelte";
</script>

<div class="flex min-h-[60vh] items-center justify-center">
  <div
    class="w-full max-w-sm rounded-[2rem] border border-border bg-[color:var(--color-panel)] p-8 backdrop-blur-sm"
  >
    <h1 class="mb-6 text-center text-2xl font-semibold">{m.auth_signInTitle()}</h1>

    <OAuthButtons />

    <div class="mt-6 text-center">
      <a
        class="text-xs text-muted-foreground underline transition hover:text-foreground"
        href="/admin-signin"
      >
        {m.auth_adminSignIn()}
      </a>
    </div>
  </div>
</div>
