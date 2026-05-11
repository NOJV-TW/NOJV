<script lang="ts" module>
  export type CornerPos = "tl" | "tr" | "bl" | "br";

  const POSITION_CLASS: Record<CornerPos, string> = {
    tl: "top-3 left-3",
    tr: "top-3 right-3",
    bl: "bottom-3 left-3",
    br: "bottom-3 right-3"
  };

  const ROTATION: Record<CornerPos, number> = { tl: 0, tr: 90, bl: -90, br: 180 };
</script>

<script lang="ts">
  interface Props {
    pos: CornerPos;
  }

  let { pos }: Props = $props();
</script>

<div
  class="absolute text-muted-foreground/40 {POSITION_CLASS[pos]}"
  style="transform: rotate({ROTATION[pos]}deg);"
>
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M0 5V0h5" />
  </svg>
</div>
