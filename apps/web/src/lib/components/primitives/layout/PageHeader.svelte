<script lang="ts">
  import { cn } from "$lib/utils/css.js";
  import type { Snippet } from "svelte";

  interface Props {
    eyebrow: string;
    title: string;
    description?: string | undefined;
    icon?: Snippet | undefined;
    actions?: Snippet | undefined;
    showTitle?: boolean;
    class?: string | undefined;
  }

  let {
    eyebrow,
    title,
    description,
    icon,
    actions,
    showTitle = false,
    class: className,
  }: Props = $props();
</script>

{#if showTitle}
  <header
    class={cn("animate-in mb-8 flex flex-wrap items-start justify-between gap-4", className)}
  >
    <div class="flex items-start gap-3">
      {#if icon}
        <span class="shrink-0 text-primary" aria-hidden="true">{@render icon()}</span>
      {/if}
      <div class="min-w-0">
        {#if eyebrow}
          <p class="eyebrow text-muted-foreground">{eyebrow}</p>
        {/if}
        <h1 class="text-title-lg font-semibold tracking-tight">{title}</h1>
        {#if description}
          <p class="mt-1 text-body-sm text-muted-foreground">{description}</p>
        {/if}
      </div>
    </div>
    {#if actions}
      <div class="flex flex-wrap items-center gap-2">
        {@render actions()}
      </div>
    {/if}
  </header>
{:else}
  <h1 class="sr-only">{title}</h1>
  {#if actions}
    <header
      class={cn("animate-in mb-8 flex flex-wrap items-center justify-end gap-2", className)}
    >
      {@render actions()}
    </header>
  {/if}
{/if}
