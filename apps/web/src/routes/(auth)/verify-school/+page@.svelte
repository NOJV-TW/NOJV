<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Button } from "$lib/components/primitives/ui/button";
  import { CheckCircle2, XCircle } from "@lucide/svelte";

  let { data } = $props();

  // Notify the account page via BroadcastChannel on success
  $effect(() => {
    if (data.status !== "success") return;

    try {
      const bc = new BroadcastChannel("nojv-school-verify");
      bc.postMessage({ type: "verified", username: data.username });
      bc.close();
    } catch {
      // BroadcastChannel not supported — no-op
    }
  });
</script>

<svelte:head>
  <title>NOJV</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <Card variant="elevated" size="hero" class="w-full max-w-sm text-center">
    {#if data.status === "success"}
      <div class="flex flex-col items-center gap-4">
        <div class="flex h-16 w-16 items-center justify-center rounded-lg bg-success/15">
          <CheckCircle2 class="h-8 w-8 text-success" aria-hidden="true" />
        </div>
        <h1 class="text-title-lg font-semibold text-success">
          {m.verifySchool_success()}
        </h1>
        <p class="text-body-sm text-muted-foreground">
          {m.verifySchool_successMessage({ username: data.username })}
        </p>
        <Button href="/" variant="default">{m.common_back()}</Button>
      </div>
    {:else}
      <div class="flex flex-col items-center gap-4">
        <div class="flex h-16 w-16 items-center justify-center rounded-lg bg-destructive/15">
          <XCircle class="h-8 w-8 text-destructive" aria-hidden="true" />
        </div>
        <h1 class="text-title-lg font-semibold text-destructive">
          {m.verifySchool_failed()}
        </h1>
        <p class="text-body-sm text-muted-foreground">{data.detail}</p>
        <Button href="/" variant="outline">{m.common_back()}</Button>
      </div>
    {/if}
  </Card>
</div>
