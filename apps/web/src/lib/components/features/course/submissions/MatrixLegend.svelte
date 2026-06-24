<script lang="ts">
  import type { MatrixViewLabels } from "./MatrixView.svelte";

  interface Props {
    labels: MatrixViewLabels;
  }

  let { labels }: Props = $props();
</script>

<div class="flex flex-wrap items-center gap-5 text-caption text-muted-foreground">
  <span class="inline-flex items-center gap-1.5">
    <span
      class="inline-block h-[14px] w-[18px] rounded-[2px] border border-border-subtle bg-success/15"
    ></span>
    {labels.legendAc()}
  </span>
  <span class="inline-flex items-center gap-1.5">
    <span
      class="inline-block h-[14px] w-[18px] rounded-[2px] border border-border-subtle bg-destructive/10"
    ></span>
    {labels.legendPartial()}
  </span>
  <span class="inline-flex items-center gap-1.5">
    <span
      class="inline-block h-[14px] w-[18px] rounded-[2px] border border-border-subtle bg-destructive/20"
    ></span>
    {labels.legendZero()}
  </span>
  <span class="inline-flex items-center gap-1.5">
    <span
      class="inline-block h-[14px] w-[18px] rounded-[2px] border border-border-subtle"
      style="background: repeating-linear-gradient(45deg, transparent, transparent 3px, var(--border-subtle) 3px, var(--border-subtle) 6px);"
    ></span>
    {labels.legendEmpty()}
  </span>
  {#if labels.legendPractice}
    <span class="inline-flex items-center gap-1.5">
      <span
        class="inline-flex h-[14px] w-[18px] items-center justify-center rounded-[2px] border border-border-subtle text-[9px] font-semibold text-muted-foreground"
        >P</span
      >
      {labels.legendPractice()}
    </span>
  {/if}
</div>
