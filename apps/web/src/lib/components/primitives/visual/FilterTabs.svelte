<script lang="ts" generics="K extends string">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils/css.js";

  interface FilterTab {
    key: K;
    label: string;
    count?: number;
    tour?: string;
  }

  interface Props {
    tabs: FilterTab[];
    value: K;
    label: string;
    onSelect: (key: K) => void;
    class?: string;
    children?: Snippet;
  }

  let { tabs, value, label, onSelect, class: className, children }: Props = $props();
</script>

<div
  class={cn(
    "flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-subtle",
    className,
  )}
>
  <div
    role="tablist"
    aria-label={label}
    class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
  >
    {#each tabs as tab (tab.key)}
      {@const isActive = tab.key === value}
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        data-tour={tab.tour}
        onclick={() => onSelect(tab.key)}
        class="-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-5 py-3.5 text-body-sm font-medium transition-colors duration-fast ease-out-soft {isActive
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'}"
      >
        <span>{tab.label}</span>
        {#if tab.count !== undefined}
          <span class="text-caption tabular-nums text-muted-foreground">{tab.count}</span>
        {/if}
      </button>
    {/each}
  </div>
  {@render children?.()}
</div>
