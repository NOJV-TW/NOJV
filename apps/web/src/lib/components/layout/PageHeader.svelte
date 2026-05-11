<script lang="ts">
  import { cn } from "$lib/utils.js";
  import type { Snippet } from "svelte";

  interface Props {
    eyebrow: string;
    title: string;
    description?: string | undefined;
    actions?: Snippet | undefined;
    class?: string | undefined;
  }

  let { eyebrow, title, description, actions, class: className }: Props = $props();
</script>

<header class={cn("animate-in mb-8", className)}>
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0 flex-1">
      <p class="text-caption uppercase tracking-[0.12em] text-muted-foreground">
        {eyebrow}
      </p>
      <h1 class="mt-1 text-display font-medium tracking-[-0.02em]">
        {title}
      </h1>
      {#if description}
        <p class="mt-2 text-body text-muted-foreground">
          {description}
        </p>
      {/if}
    </div>
    {#if actions}
      <div class="flex shrink-0 items-center gap-2">
        {@render actions()}
      </div>
    {/if}
  </div>
</header>
