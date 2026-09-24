<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    children?: Snippet;
    disabled?: boolean;
    onclick?: (event: MouseEvent) => void;
    size?: string;
    variant?: string;
  }

  let { children, disabled = false, onclick }: Props = $props();
</script>

<button {disabled} {onclick}>
  {@render children?.()}
</button>
