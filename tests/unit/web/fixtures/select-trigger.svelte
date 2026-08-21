<script lang="ts">
  import type { Snippet } from "svelte";

  let { children, ...props }: { children?: Snippet; [key: string]: unknown } = $props();
</script>

<button {...props} type="button">{@render children?.()}</button>
