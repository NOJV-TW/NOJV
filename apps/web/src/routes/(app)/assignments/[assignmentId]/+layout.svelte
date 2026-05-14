<script lang="ts">
  import type { Snippet } from "svelte";
  import type { LayoutData } from "./$types";

  interface Props {
    data: LayoutData;
    children?: Snippet;
  }

  let { children }: Props = $props();
</script>

{@render children?.()}
