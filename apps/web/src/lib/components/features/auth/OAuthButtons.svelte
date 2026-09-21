<script lang="ts">
  import { authClient } from "$lib/auth.client";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import ProviderIcon from "$lib/components/features/auth/ProviderIcon.svelte";

  let inFlightProvider = $state<"github" | "google" | null>(null);

  async function handleOAuth(provider: "github" | "google") {
    if (inFlightProvider) return;

    inFlightProvider = provider;
    try {
      await authClient.signIn.social({
        callbackURL: "/",
        errorCallbackURL: "/signin",
        provider,
      });
    } catch {
      inFlightProvider = null;
    }
  }
</script>

<div class="flex flex-col gap-3">
  <Button
    variant="outline"
    size="lg"
    loading={inFlightProvider === "github"}
    disabled={inFlightProvider !== null}
    onclick={() => void handleOAuth("github")}
  >
    <ProviderIcon provider="github" />
    {inFlightProvider === "github" ? m.auth_connectingGithub() : m.auth_continueWithGithub()}
  </Button>
  <Button
    variant="outline"
    size="lg"
    loading={inFlightProvider === "google"}
    disabled={inFlightProvider !== null}
    onclick={() => void handleOAuth("google")}
  >
    <ProviderIcon provider="google" />
    {inFlightProvider === "google" ? m.auth_connectingGoogle() : m.auth_continueWithGoogle()}
  </Button>
</div>
