<script lang="ts">
  import { enhance } from "$app/forms";
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Button } from "$lib/components/primitives/ui/button";
  import { CheckCircle2, XCircle, Mail } from "@lucide/svelte";

  let { data, form } = $props();

  const result = $derived(form ?? data);
</script>

<svelte:head>
  <title>NOJV</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <Card variant="elevated" size="hero" class="w-full max-w-sm text-center">
    {#if result.status === "success"}
      <div class="flex flex-col items-center gap-4">
        <div class="flex h-16 w-16 items-center justify-center rounded-lg bg-success/15">
          <CheckCircle2 class="h-8 w-8 text-success" aria-hidden="true" />
        </div>
        <h1 class="text-title-lg font-semibold text-success">
          {m.verifyNotificationEmail_success()}
        </h1>
        <p class="text-body-sm text-muted-foreground">
          {m.verifyNotificationEmail_successMessage({ email: result.email })}
        </p>
        <Button href="/settings" variant="default">{m.common_back()}</Button>
      </div>
    {:else if result.status === "confirm"}
      <form method="POST" use:enhance class="flex flex-col items-center gap-4">
        <input type="hidden" name="token" value={result.token} />
        <div class="flex h-16 w-16 items-center justify-center rounded-lg bg-primary/15">
          <Mail class="h-8 w-8 text-primary" aria-hidden="true" />
        </div>
        <h1 class="text-title-lg font-semibold">{m.verifyNotificationEmail_confirmTitle()}</h1>
        <p class="text-body-sm text-muted-foreground">
          {m.verifyNotificationEmail_confirmPrompt({ email: result.email })}
        </p>
        <Button type="submit" variant="default"
          >{m.verifyNotificationEmail_confirmButton()}</Button
        >
      </form>
    {:else}
      <div class="flex flex-col items-center gap-4">
        <div class="flex h-16 w-16 items-center justify-center rounded-lg bg-destructive/15">
          <XCircle class="h-8 w-8 text-destructive" aria-hidden="true" />
        </div>
        <h1 class="text-title-lg font-semibold text-destructive">
          {m.verifyNotificationEmail_failed()}
        </h1>
        <p class="text-body-sm text-muted-foreground">{result.detail}</p>
        <Button href="/settings" variant="outline">{m.common_back()}</Button>
      </div>
    {/if}
  </Card>
</div>
