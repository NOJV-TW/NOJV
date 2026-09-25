<script lang="ts" generics="K extends string">
  import type { Snippet } from "svelte";
  import { Tabs as TabsPrimitive } from "bits-ui";
  import { cn } from "$lib/utils/css.js";
  import GlassPanel from "$lib/components/primitives/visual/GlassPanel.svelte";

  type TabItem = { key: K; label: string; count?: number };

  let {
    tabs,
    value = $bindable(),
    label,
    id = "tabs",
    children,
    actions,
    onValueChange,
    class: className,
    contentClass = "p-6",
  }: {
    tabs: TabItem[];
    value: K;
    label: string;
    id?: string;
    children: Snippet;
    actions?: Snippet;
    onValueChange?: (value: K) => void;
    class?: string;
    contentClass?: string;
  } = $props();

  function selectTab(next: string) {
    value = next as K;
    onValueChange?.(value);
  }
</script>

<TabsPrimitive.Root {value} onValueChange={selectTab} class="contents">
  <GlassPanel class={cn("overflow-hidden", className)}>
    <div class="flex flex-col border-b border-border-subtle sm:flex-row sm:items-center">
      <div class="min-w-0 overflow-x-auto px-3 py-2">
        <TabsPrimitive.List aria-label={label} class="flex items-center gap-1">
          {#each tabs as tab (tab.key)}
            {@const isActive = value === tab.key}
            <TabsPrimitive.Trigger
              value={tab.key}
              id={`${id}-tab-${tab.key}`}
              class={cn(
                "focus-ring inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3.5 text-body-sm font-medium transition-colors",
                isActive
                  ? "bg-[color:var(--color-primary)]/14 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span>{tab.label}</span>
              {#if tab.count !== undefined}
                <span
                  class={cn(
                    "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-micro font-semibold tabular-nums",
                    isActive
                      ? "bg-[color:var(--color-primary)]/20 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {tab.count}
                </span>
              {/if}
            </TabsPrimitive.Trigger>
          {/each}
        </TabsPrimitive.List>
      </div>
      {#if actions}
        <div
          class="flex shrink-0 items-center justify-end gap-3 border-t border-border-subtle px-3 py-2 sm:ml-auto sm:border-t-0 sm:pl-0"
        >
          {@render actions()}
        </div>
      {/if}
    </div>

    <TabsPrimitive.Content
      {value}
      id={`${id}-panel`}
      class={cn("focus-visible:outline-none", contentClass)}
    >
      {@render children()}
    </TabsPrimitive.Content>
  </GlassPanel>
</TabsPrimitive.Root>
