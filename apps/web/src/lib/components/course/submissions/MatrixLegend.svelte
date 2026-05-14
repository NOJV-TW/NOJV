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
      class="inline-block h-[14px] w-[18px] rounded-[2px] border border-border-subtle bg-[color:rgba(77,141,91,0.14)]"
    ></span>
    {labels.legendAc()}
  </span>
  <span class="inline-flex items-center gap-1.5">
    <span
      class="inline-block h-[14px] w-[18px] rounded-[2px] border border-border-subtle bg-[color:rgba(184,55,42,0.1)]"
    ></span>
    {labels.legendPartial()}
  </span>
  <span class="inline-flex items-center gap-1.5">
    <span
      class="inline-block h-[14px] w-[18px] rounded-[2px] border border-border-subtle bg-[color:rgba(184,55,42,0.18)]"
    ></span>
    {labels.legendZero()}
  </span>
  <span class="inline-flex items-center gap-1.5">
    <span
      class="inline-block h-[14px] w-[18px] rounded-[2px] border border-border-subtle"
      style="background: repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(79, 52, 35, 0.04) 3px, rgba(79, 52, 35, 0.04) 6px);"
    ></span>
    {labels.legendEmpty()}
  </span>
</div>
