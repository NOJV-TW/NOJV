<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    isResizing: boolean;
    height: number;
    minHeight?: number;
    maxHeight?: number;
    onMouseDown: (e: MouseEvent) => void;
    onHeightChange: (next: number) => void;
  }

  let {
    isResizing,
    height,
    minHeight = 120,
    maxHeight = 800,
    onMouseDown,
    onHeightChange,
  }: Props = $props();

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "ArrowUp") onHeightChange(Math.min(maxHeight, height + 16));
    if (e.key === "ArrowDown") onHeightChange(Math.max(minHeight, height - 16));
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="group flex h-2 shrink-0 cursor-row-resize flex-col items-stretch justify-center outline-none"
  role="separator"
  aria-orientation="horizontal"
  aria-label={m.common_resizeBottomPanel()}
  tabindex="0"
  onmousedown={onMouseDown}
  {onkeydown}
>
  <span
    aria-hidden="true"
    class="h-px transition-colors duration-fast {isResizing
      ? 'bg-primary'
      : 'bg-transparent group-hover:bg-primary/60 group-focus-visible:bg-primary/60'}"
  ></span>
</div>
