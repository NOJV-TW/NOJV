<script lang="ts">
  import { ListFilter } from "@lucide/svelte";
  import { Select as SelectPrimitive } from "bits-ui";
  import * as Select from "$lib/components/primitives/ui/select";

  interface Option {
    value: string;
    label: string;
  }

  interface Props {
    label: string;
    filterLabel: string;
    value: string;
    options: readonly Option[];
    allLabel?: string;
    onChange?: (value: string) => void;
  }

  let {
    label,
    filterLabel,
    value = $bindable(),
    options,
    allLabel = label,
    onChange,
  }: Props = $props();

  const activeLabel = $derived(
    options.find((option) => option.value === value)?.label ?? value,
  );

  function handleChange(nextValue: string) {
    value = nextValue;
    onChange?.(value);
  }
</script>

<Select.Root type="single" bind:value onValueChange={handleChange}>
  <SelectPrimitive.Trigger
    type="button"
    class="-ml-1 inline-flex h-8 min-w-0 items-center gap-1.5 rounded-sm px-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {value
      ? 'bg-primary/10 text-primary hover:bg-primary/15'
      : 'hover:bg-muted hover:text-foreground'}"
    aria-label={filterLabel}
  >
    <span class="max-w-32 truncate" title={value ? activeLabel : undefined}>
      {value ? activeLabel : label}
    </span>
    <ListFilter aria-hidden="true" class="size-3.5 shrink-0" />
  </SelectPrimitive.Trigger>
  <Select.Content>
    <Select.Item value="" label={allLabel}>{allLabel}</Select.Item>
    {#each options as option (option.value)}
      <Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
    {/each}
  </Select.Content>
</Select.Root>
