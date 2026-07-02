<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils/css.js";

  interface Props {
    children: Snippet;
    class?: string;
  }

  let { children, class: className }: Props = $props();
</script>

<div class={cn("flex flex-wrap gap-3", className)}>
  {@render children()}
</div>
