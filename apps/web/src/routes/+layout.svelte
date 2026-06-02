<script lang="ts">
  import "../app.css";
  import ToastProvider from "$lib/components/primitives/ui/ToastProvider.svelte";
  import ShortcutOverlay from "$lib/components/primitives/ui/ShortcutOverlay.svelte";
  import { useGlobalShortcuts } from "$lib/stores/shortcuts.svelte.js";
  import { onNavigate } from "$app/navigation";

  let { children } = $props();

  useGlobalShortcuts();

  onNavigate((navigation) => {
    if (!document.startViewTransition || navigation.to?.route.id === navigation.from?.route.id) {
      return;
    }
    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });
</script>

{@render children()}

<ToastProvider />
<ShortcutOverlay />
