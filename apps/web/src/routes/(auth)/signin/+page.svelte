<script lang="ts">
  import { page } from "$app/state";
  import { m } from "$lib/paraglide/messages.js";
  import OAuthButtons from "$lib/components/features/auth/OAuthButtons.svelte";
  import ExamPasswordLogin from "$lib/components/features/auth/ExamPasswordLogin.svelte";
  import { Card } from "$lib/components/primitives/ui/card";

  const errorText = $derived.by(() => {
    const code = page.url.searchParams.get("error");
    if (!code) return null;
    if (code === "account_not_linked") return m.auth_error_accountNotLinked();
    if (code === "account_already_linked_to_different_user")
      return m.auth_error_claimedByOther();
    return m.auth_error_generic();
  });
</script>

<div class="flex min-h-[60vh] items-center justify-center">
  <Card variant="elevated" size="hero" class="w-full max-w-sm">
    <h1 class="text-center text-display font-semibold">
      {m.auth_signInTitle()}
    </h1>

    {#if errorText}
      <p
        class="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-body-sm text-destructive"
        role="alert"
      >
        {errorText}
      </p>
    {/if}

    <div class="flex flex-col gap-3">
      <OAuthButtons />
      <ExamPasswordLogin />
    </div>

    <div class="border-t border-border-subtle pt-3 text-center">
      <a
        class="text-caption text-muted-foreground underline-offset-4 transition-colors duration-fast ease-out-soft hover:text-foreground hover:underline"
        href="/admin-signin"
      >
        {m.auth_adminSignIn()}
      </a>
    </div>
  </Card>
</div>
