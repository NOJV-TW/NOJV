<script lang="ts">
  import { page } from "$app/state";
  import { AlertTriangle } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
</script>

<div
  class="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-6 text-center"
>
  <div class="rounded-full bg-destructive/10 p-4">
    <AlertTriangle class="h-10 w-10 text-destructive" />
  </div>
  <div class="space-y-2">
    <p class="font-mono text-sm text-muted-foreground">{page.status}</p>
    <h1 class="text-2xl font-semibold">{page.error?.message ?? m.error_unexpected()}</h1>
  </div>
  <a
    href="/"
    class="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5"
  >
    {m.error_backHome()}
  </a>
</div>
