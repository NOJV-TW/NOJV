<script lang="ts">
  import { cn } from "$lib/utils.js";
  import type { Snippet } from "svelte";

  interface Props {
    children: Snippet;
    class?: string | undefined;
  }

  let { children, class: className }: Props = $props();
</script>

<div class={cn("pb-24", className)}>
  {@render children()}
</div>
