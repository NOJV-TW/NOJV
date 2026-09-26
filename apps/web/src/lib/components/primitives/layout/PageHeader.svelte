<script lang="ts">
  import { cn } from "$lib/utils/css.js";
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    actions?: Snippet | undefined;
    class?: string | undefined;
  }

  let { title, actions, class: className }: Props = $props();
</script>

<h1 class="sr-only">{title}</h1>
{#if actions}
  <header
    class={cn("animate-in mb-8 flex flex-wrap items-center justify-end gap-2", className)}
  >
    {@render actions()}
  </header>
{/if}
