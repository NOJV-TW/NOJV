<script lang="ts">
  import { authClient } from "$lib/auth-client";

  async function handleOAuth(provider: "github" | "google") {
    await authClient.signIn.social({ callbackURL: "/", provider });
  }
</script>

<div class="flex flex-col gap-3">
  <button
    class="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-border py-2.5 text-sm font-medium transition hover:bg-[color:var(--color-panel)]"
    onclick={() => void handleOAuth("github")}
    type="button"
  >
    GitHub
  </button>
  <button
    class="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-border py-2.5 text-sm font-medium transition hover:bg-[color:var(--color-panel)]"
    onclick={() => void handleOAuth("google")}
    type="button"
  >
    Google
  </button>
</div>
