<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    subtitle: string;
    children: Snippet;
  }

  let { title, subtitle, children }: Props = $props();
</script>

<div
  class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur-sm"
>
  <div class="mb-6 flex items-center gap-3">
    <div>
      <h2 class="text-title-sm font-medium tracking-[-0.01em]">
        {title}
      </h2>
      <p class="mt-0.5 text-caption text-muted-foreground">
        {subtitle}
      </p>
    </div>
  </div>
  {@render children()}
</div>
