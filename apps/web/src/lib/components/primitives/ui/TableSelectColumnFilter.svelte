<script lang="ts">
  import { ListFilter } from "@lucide/svelte";

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

  function handleChange(event: Event) {
    value = (event.currentTarget as HTMLSelectElement).value;
    onChange?.(value);
  }
</script>

<label
  class="relative -ml-1 inline-flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-sm px-1 font-medium transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-ring {value
    ? 'bg-primary/10 text-primary hover:bg-primary/15'
    : 'hover:bg-muted hover:text-foreground'}"
>
  <span class="max-w-32 truncate" title={value ? activeLabel : undefined}>
    {value ? activeLabel : label}
  </span>
  <ListFilter aria-hidden="true" class="size-3.5 shrink-0" />
  <select
    class="absolute inset-0 size-full cursor-pointer opacity-0"
    aria-label={filterLabel}
    bind:value
    onchange={handleChange}
  >
    <option value="">{allLabel}</option>
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
</label>
