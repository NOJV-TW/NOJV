<script lang="ts">
  import { ListFilter } from "@lucide/svelte";
  import { Popover } from "bits-ui";
  import { Button } from "$lib/components/primitives/ui/button";
  import { Input } from "$lib/components/primitives/ui/input";

  interface Props {
    label: string;
    filterLabel: string;
    inputId: string;
    applyLabel: string;
    value: string;
    onApply?: () => void;
  }

  let {
    label,
    filterLabel,
    inputId,
    applyLabel,
    value = $bindable(),
    onApply,
  }: Props = $props();
  let open = $state(false);
  let draft = $state(value);

  function applyFilter() {
    value = draft.trim();
    onApply?.();
    open = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    applyFilter();
  }
</script>

<div class="flex min-w-0 items-center gap-1">
  <Popover.Root
    bind:open
    onOpenChange={(nextOpen) => {
      if (nextOpen) draft = value;
    }}
  >
    <Popover.Trigger
      type="button"
      class="-ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {value
        ? 'bg-primary/10 text-primary hover:bg-primary/15'
        : 'hover:bg-muted hover:text-foreground'}"
      aria-label={filterLabel}
      aria-pressed={Boolean(value)}
    >
      <span>{label}</span>
      <ListFilter aria-hidden="true" class="size-3.5" />
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        sideOffset={6}
        align="start"
        role="dialog"
        aria-label={filterLabel}
        class="z-50 w-72 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
      >
        <div class="grid gap-2">
          <label for={inputId} class="text-caption font-medium">{filterLabel}</label>
          <Input
            id={inputId}
            type="search"
            bind:value={draft}
            placeholder={filterLabel}
            onkeydown={handleKeydown}
          />
          <Button type="button" size="sm" onclick={applyFilter}>{applyLabel}</Button>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
  {#if value}
    <span
      class="max-w-28 truncate rounded-sm bg-primary/10 px-1.5 py-0.5 text-caption font-medium normal-case tracking-normal text-primary"
      title={value}
    >
      {value}
    </span>
  {/if}
</div>
