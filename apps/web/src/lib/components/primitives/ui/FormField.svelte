<script lang="ts" module>
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils/css.js";

  interface Props {
    label: string;
    hint?: string;
    error?: string;
    required?: boolean;
    for?: string;
    requiredMarker?: string;
    requiredLabel?: string;
    class?: string;
    children: Snippet;
  }

  let {
    label,
    hint,
    error,
    required = false,
    for: htmlFor,
    requiredMarker = "*",
    requiredLabel = "required",
    class: className,
    children,
  }: Props = $props();
</script>

<div class={cn("flex flex-col gap-1.5", className)}>
  <label for={htmlFor} class="text-[length:var(--text-body-sm)] font-medium">
    {label}
    {#if required}
      <span class="text-destructive ml-0.5" aria-hidden="true">{requiredMarker}</span>
      <span class="sr-only">{requiredLabel}</span>
    {/if}
  </label>
  {@render children()}
  {#if error}
    <p class="text-[length:var(--text-caption)] text-destructive" role="alert">{error}</p>
  {:else if hint}
    <p class="text-[length:var(--text-caption)] text-muted-foreground">{hint}</p>
  {/if}
</div>
