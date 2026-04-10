<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import OAuthButtons from "$lib/components/auth/OAuthButtons.svelte";
  import { Card } from "$lib/components/ui/card";
</script>

<div class="flex min-h-[60vh] items-center justify-center">
  <Card variant="elevated" size="hero" class="w-full max-w-sm">
    <h1 class="text-center font-display text-display font-semibold">
      {m.auth_signInTitle()}
    </h1>

    <OAuthButtons />

    <div class="text-center">
      <a
        class="text-body-sm text-muted-foreground underline-offset-4 transition-colors duration-fast ease-out-soft hover:text-foreground hover:underline"
        href="/admin-signin"
      >
        {m.auth_adminSignIn()}
      </a>
    </div>
  </Card>
</div>
