<script lang="ts">
  import { authClient } from "$lib/auth-client";

  async function handleOAuth(provider: "github" | "google") {
    await authClient.signIn.social({ callbackURL: "/", provider });
  }
</script>

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
