<script lang="ts">
  import "../app.css";
  import ToastContainer from "$lib/components/ui/ToastContainer.svelte";
  import ShortcutOverlay from "$lib/components/ui/ShortcutOverlay.svelte";
  import { useGlobalShortcuts } from "$lib/stores/shortcuts.svelte.js";

  let { children } = $props();

  useGlobalShortcuts();
</script>

{@render children()}

<ToastContainer />
<ShortcutOverlay />
