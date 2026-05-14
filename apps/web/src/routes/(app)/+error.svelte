<script lang="ts">
  import { page } from "$app/state";
  import { AlertTriangle } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";

  const description = $derived(
    page.error?.message ? `${page.status} — ${page.error.message}` : `${page.status}`
  );
</script>

<div class="mx-auto flex min-h-[60vh] w-full max-w-2xl items-center justify-center">
  <EmptyState
    icon={AlertTriangle}
    variant="onboarding"
    title={m.error_unexpected()}
    {description}
    actions={[{ href: "/", label: m.error_backHome(), variant: "default" }]}
  />
</div>
