<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils/css.js";

  interface Props {
    class?: string;
    children?: Snippet;
  }

  let { class: className, children }: Props = $props();
</script>

<div class={cn("glass rounded-xl shadow-rest", className)}>
  {@render children?.()}
</div>
