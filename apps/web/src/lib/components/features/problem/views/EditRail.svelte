<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    nav?: Snippet | undefined;
    actions?: Snippet | undefined;
    tourTarget?: boolean;
    mobileFullWidth?: boolean;
  }

  let { nav, actions, tourTarget = true, mobileFullWidth = false }: Props = $props();
</script>

<aside
  data-tour={tourTarget ? "edit-rail" : undefined}
  class="shrink-0 rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-2 shadow-rest {mobileFullWidth
    ? 'w-full self-stretch lg:sticky lg:top-[100px] lg:w-52 lg:self-start'
    : 'sticky top-[100px] w-52 self-start'}"
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
