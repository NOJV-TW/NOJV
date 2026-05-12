<script lang="ts">
  import { AlertCircle } from "@lucide/svelte";

  interface Props {
    message: string | null | undefined;
  }

  let { message }: Props = $props();
</script>

{#if message}
  <div
    role="alert"
    aria-live="polite"
    class="mb-4 flex items-start gap-3 rounded-md border border-destructive/40 border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 text-destructive"
    data-testid="form-error"
  >
    <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
    <p class="text-body-sm font-medium leading-snug">{message}</p>
  </div>
{/if}
