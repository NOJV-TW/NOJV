<script lang="ts">
  interface Props {
    text: string;
  }

  let { text }: Props = $props();
</script>

<div
  class="overflow-hidden whitespace-nowrap py-2 border-b"
  style="border-color: var(--border-subtle); background: color-mix(in oklab, var(--panel-strong) 90%, transparent);"
>
  <div class="inline-block" style="animation: marquee 45s linear infinite;">
    {#each [0, 1, 2] as i (i)}
      <span
        class="inline-flex items-center gap-6 px-6 font-mono text-micro uppercase tracking-[0.3em] text-muted-foreground"
      >
        {text}
        <span style="color: var(--primary);">◆</span>
        {text}
        <span style="color: var(--primary);">◆</span>
      </span>
    {/each}
  </div>
</div>
