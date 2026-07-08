<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import OAuthButtons from "$lib/components/features/auth/OAuthButtons.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
</script>

<div class="flex min-h-[60vh] items-center justify-center">
  <Card variant="elevated" size="hero" class="w-full max-w-sm">
    <h1 class="text-center text-display font-semibold">
      {m.auth_signInTitle()}
    </h1>

    <OAuthButtons />

    <div class="border-t border-border pt-3 text-center">
      <a
        class="text-caption text-muted-foreground underline-offset-4 transition-colors duration-fast ease-out-soft hover:text-foreground hover:underline"
        href="/admin-signin"
      >
        {m.auth_adminSignIn()}
      </a>
    </div>
  </Card>
</div>
