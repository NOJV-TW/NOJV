<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    number: number;
    title: string;
    subtitle: string;
    required?: boolean;
    children: Snippet;
  }

  let { number, title, subtitle, required = false, children }: Props = $props();
</script>

<div
  class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur-sm"
>
  <div class="mb-6 flex items-center gap-3">
    <span
      class="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-caption font-semibold text-background"
      aria-hidden="true"
    >
      {number}
    </span>
    <div>
      <h2 class="text-title-sm font-medium tracking-[-0.01em]">
        {title}
        {#if required}<span class="text-destructive">*</span>{/if}
      </h2>
      <p class="mt-0.5 text-caption text-muted-foreground">
        {subtitle}
      </p>
    </div>
  </div>
  {@render children()}
</div>
