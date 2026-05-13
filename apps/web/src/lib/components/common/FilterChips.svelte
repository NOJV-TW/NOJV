<script lang="ts" module>
  export interface FilterChipOption {
    value: string;
    label: string;
    count?: number;
  }
</script>

<script lang="ts">
  import { cn } from "$lib/utils/css.js";

  interface Props {
    options: FilterChipOption[];
    value: string;
    onChange?: (value: string) => void;
    class?: string;
    ariaLabel?: string;
  }

  let {
    options,
    value = $bindable(""),
    onChange,
    class: className,
    ariaLabel
  }: Props = $props();

  function select(next: string) {
    value = next;
    onChange?.(next);
  }
</script>

<div
  role="radiogroup"
  aria-label={ariaLabel}
  data-slot="filter-chips"
  class={cn("flex flex-wrap items-center gap-2", className)}
>
  {#each options as option (option.value)}
    {@const active = option.value === value}
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-active={active ? "true" : undefined}
      onclick={() => select(option.value)}
      class={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-body-sm font-medium transition-[color,background-color,border-color,transform] duration-fast ease-out-soft",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-[color:var(--color-panel)] text-muted-foreground hover:border-border-strong hover:text-foreground"
      )}
    >
      <span>{option.label}</span>
      {#if option.count !== undefined}
        <span
          class={cn(
            "inline-flex min-w-[1.1rem] items-center justify-center rounded-full px-1.5 text-micro font-semibold tabular-nums",
            active
              ? "bg-background/18 text-background"
              : "bg-muted text-muted-foreground"
          )}
        >
          {option.count}
        </span>
      {/if}
    </button>
  {/each}
</div>
