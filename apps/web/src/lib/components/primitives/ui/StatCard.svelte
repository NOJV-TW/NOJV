<script lang="ts" module>
  import type { Component } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils/css.js";
  import { Card } from "$lib/components/primitives/ui/card/index.js";

  export type StatCardProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    label: string;
    value: string | number;
    icon?: Component<{ class?: string }>;
  };
</script>

<script lang="ts">
  let {
    ref = $bindable(null),
    class: className,
    label,
    value,
    icon: Icon,
    ...restProps
  }: StatCardProps = $props();
</script>

<Card
  bind:ref
  variant="surface"
  size="md"
  data-slot="stat-card"
  class={cn(className)}
  {...restProps}
>
  <div class="flex items-start justify-between gap-3">
    <span class="text-caption font-medium tracking-wide uppercase text-muted-foreground">
      {label}
    </span>
    {#if Icon}
      <Icon class="h-5 w-5 shrink-0 text-muted-foreground" />
    {/if}
  </div>
  <div class="flex items-end justify-between gap-3">
    <span class="text-headline leading-tight font-semibold tabular-nums">
      {value}
    </span>
  </div>
</Card>
