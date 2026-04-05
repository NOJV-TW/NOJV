<script lang="ts">
  import { authClient } from "$lib/auth-client";

  let inFlightProvider = $state<"github" | "google" | null>(null);

  async function handleOAuth(provider: "github" | "google") {
    if (inFlightProvider) return;

    inFlightProvider = provider;
    try {
      await authClient.signIn.social({ callbackURL: "/", provider });
    } finally {
      // Keep UX recoverable if redirect is blocked or request errors locally.
      inFlightProvider = null;
    }
  }
</script>

<div class="flex flex-col gap-3">
  <button
    class="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-border py-2.5 text-sm font-medium transition hover:bg-(--color-panel)"
    disabled={inFlightProvider !== null}
    onclick={() => void handleOAuth("github")}
    type="button"
  >
    {inFlightProvider === "github" ? "GitHub (connecting...)" : "GitHub"}
  </button>
  <button
    class="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-border py-2.5 text-sm font-medium transition hover:bg-(--color-panel)"
    disabled={inFlightProvider !== null}
    onclick={() => void handleOAuth("google")}
    type="button"
  >
    {inFlightProvider === "google" ? "Google (connecting...)" : "Google"}
  </button>
</div>
