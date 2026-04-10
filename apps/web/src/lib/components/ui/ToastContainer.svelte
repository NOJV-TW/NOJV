<script lang="ts">
  import { X } from "@lucide/svelte";
  import { toasts } from "$lib/stores/toast";

  const typeStyles: Record<string, string> = {
    success: "border-emerald-500/30 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
    error: "border-red-500/30 bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    info: "border-blue-500/30 bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
  };
</script>

<div
  class="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
  role="status"
  aria-live="polite"
  aria-atomic="false"
>
  {#each $toasts as toast (toast.id)}
    <div
      class="flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-lg transition-all {typeStyles[toast.type] ?? typeStyles.info}"
    >
      <span class="text-sm">{toast.message}</span>
      <button
        class="shrink-0 opacity-60 transition hover:opacity-100"
        onclick={() => toasts.remove(toast.id)}
        type="button"
        aria-label="Dismiss notification"
      >
        <X class="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  {/each}
</div>
