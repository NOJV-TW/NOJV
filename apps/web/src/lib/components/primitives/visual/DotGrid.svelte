<script lang="ts">
  import { cn } from "$lib/utils/css.js";

  interface Props {
    opacity?: number;
    class?: string;
  }

  let { opacity = 0.25, class: className }: Props = $props();
</script>

<div
  class={cn("pointer-events-none absolute inset-0", className)}
  style="background-image: radial-gradient(currentColor 1px, transparent 1px); background-size: 14px 14px; color: var(--border-strong); opacity: {opacity}; mask-image: radial-gradient(120% 60% at 50% 0%, black 30%, transparent 80%); -webkit-mask-image: radial-gradient(120% 60% at 50% 0%, black 30%, transparent 80%);"
></div>
