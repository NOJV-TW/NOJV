<script lang="ts" generics="K extends string">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils/css.js";
  import GlassPanel from "$lib/components/primitives/visual/GlassPanel.svelte";

  type TabItem = { key: K; label: string; count?: number };

  let {
    tabs,
    value = $bindable(),
    label,
    id = "tabs",
    children,
    class: className,
    contentClass = "p-6",
  }: {
    tabs: TabItem[];
    value: K;
    label: string;
    id?: string;
    children: Snippet;
    class?: string;
    contentClass?: string;
  } = $props();

  function onTabKeydown(event: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const keys = tabs.map((t) => t.key);
    if (keys.length === 0) return;
    const cur = keys.indexOf(value);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? keys.length - 1
          : event.key === "ArrowLeft"
            ? (cur - 1 + keys.length) % keys.length
            : (cur + 1) % keys.length;
    const nextKey = keys[next];
    if (!nextKey) return;
    value = nextKey;
    document.getElementById(`${id}-tab-${nextKey}`)?.focus();
  }
</script>

<GlassPanel class={cn("overflow-hidden", className)}>
  <div
    role="tablist"
    aria-label={label}
    class="flex items-center gap-1 overflow-x-auto border-b border-border-subtle px-3 py-2"
  >
    {#each tabs as tab (tab.key)}
      {@const isActive = value === tab.key}
      <button
        id={`${id}-tab-${tab.key}`}
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-controls={`${id}-panel`}
        tabindex={isActive ? 0 : -1}
        onclick={() => (value = tab.key)}
        onkeydown={onTabKeydown}
        class={cn(
          "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3.5 text-body-sm font-medium transition-colors",
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
      </button>
    {/each}
  </div>

  <div
    id={`${id}-panel`}
    role="tabpanel"
    aria-labelledby={`${id}-tab-${value}`}
    tabindex="0"
    class={cn("focus-visible:outline-none", contentClass)}
  >
    {@render children()}
  </div>
</GlassPanel>
