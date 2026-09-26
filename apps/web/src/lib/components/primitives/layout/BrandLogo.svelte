<script lang="ts">
  import { cn } from "$lib/utils/css.js";

  let { class: className }: { class?: string } = $props();
</script>

<span class={cn("inline-flex items-center gap-2", className)}>
  <span
    class="flex size-9 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-primary text-title-sm font-bold leading-none text-primary-foreground shadow-rest"
    aria-hidden="true"
  >
    V
  </span>
  <span class="text-title-sm font-bold tracking-tight">NOJV</span>
</span>
