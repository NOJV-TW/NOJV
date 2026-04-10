<script lang="ts">
  import { toasts } from "$lib/stores/toast";
  import ToastItem from "./toast/ToastItem.svelte";
</script>

<div
  class="pointer-events-none fixed bottom-4 left-4 right-4 z-[var(--z-toast)] flex flex-col items-end gap-2 sm:left-auto sm:right-4"
  aria-live="polite"
  aria-atomic="false"
>
  {#each $toasts as toast (toast.id)}
    <ToastItem {toast} />
  {/each}
</div>
