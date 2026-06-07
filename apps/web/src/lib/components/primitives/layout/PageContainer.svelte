<script lang="ts">
  import { cn } from "$lib/utils/css.js";
  import type { Snippet } from "svelte";

  type Width = "full" | "form";

  interface Props {
    children: Snippet;
    width?: Width;
    class?: string | undefined;
  }

  let { children, width = "full", class: className }: Props = $props();

  const widthClass: Record<Width, string> = {
    full: "w-full",
    form: "mx-auto w-full max-w-3xl",
  };
</script>

<div class={cn(widthClass[width], "pb-24", className)}>
  {@render children()}
</div>
