<script lang="ts">
  import "../app.css";
  import ToastProvider from "$lib/components/ui/ToastProvider.svelte";
  import ShortcutOverlay from "$lib/components/ui/ShortcutOverlay.svelte";
  import { useGlobalShortcuts } from "$lib/stores/shortcuts.svelte.js";

  let { children } = $props();

  useGlobalShortcuts();
</script>

{@render children()}

<ToastProvider />
<ShortcutOverlay />
