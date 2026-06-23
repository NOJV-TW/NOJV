<script lang="ts">
  import { cn } from "$lib/utils/css.js";
  import type { Snippet } from "svelte";

  interface Props {
    eyebrow: string;
    title: string;
    description?: string | undefined;
    icon?: Snippet | undefined;
    actions?: Snippet | undefined;
    class?: string | undefined;
  }

  // `eyebrow`, `description` and `icon` are still accepted but no longer
  // rendered — the visible page title block was removed from the top of every
  // page. The title is kept as an sr-only heading so each page still exposes a
  // single accessible <h1>; only the action controls remain visible.
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
