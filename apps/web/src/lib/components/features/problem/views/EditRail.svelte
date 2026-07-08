<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    nav?: Snippet | undefined;
    actions?: Snippet | undefined;
  }

  let { nav, actions }: Props = $props();
</script>

<aside
  class="sticky top-[100px] w-52 shrink-0 self-start rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-2 shadow-rest"
>
  {#if nav}
    {@render nav()}
  {/if}
  {#if actions}
    <div class="space-y-2 px-1 pb-1 {nav ? 'mt-4 border-t border-border-subtle pt-4' : 'pt-1'}">
      {@render actions()}
    </div>
  {/if}
</aside>
