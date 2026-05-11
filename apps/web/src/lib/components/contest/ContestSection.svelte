<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    subtitle: string;
    badge?: string;
    children?: Snippet;
  }

  let { title, subtitle, badge, children }: Props = $props();
</script>

<section>
  <div class="flex items-end gap-3 mb-4">
    <h2 class="font-mono text-micro uppercase tracking-[0.2em] text-muted-foreground">
      {title}
    </h2>
    <span class="font-display text-body font-semibold">{subtitle}</span>
    {#if badge}
      <span
        class="inline-flex items-center gap-1.5 ml-2 rounded-full px-2.5 py-0.5 text-micro font-mono uppercase tracking-wider"
        style="background: color-mix(in oklab, var(--destructive) 14%, transparent); color: oklch(0.55 0.2 27);"
      >
        <span class="size-1.5 rounded-full live-dot" style="background: oklch(0.55 0.2 27);"></span>
        {badge}
      </span>
    {/if}
    <div class="flex-1 ml-2 border-t" style="border-color: var(--border-subtle);"></div>
  </div>
  {@render children?.()}
</section>
