<script lang="ts">
  import { Tooltip } from "bits-ui";
  import { CircleHelp } from "@lucide/svelte";

  interface Props {
    text: string;
    nowrap?: boolean;
  }

  let { text, nowrap = false }: Props = $props();

  const contentClass = $derived(
    nowrap ? "whitespace-pre" : "max-w-xs whitespace-pre-line",
  );
</script>

<Tooltip.Provider delayDuration={200}>
  <Tooltip.Root>
    <Tooltip.Trigger
      class="inline-flex cursor-help items-center align-middle text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      type="button"
      aria-label={text}
      onclick={(e: MouseEvent) => e.preventDefault()}
    >
      <CircleHelp class="size-3.5" aria-hidden="true" />
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        class="z-50 {contentClass} rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
        sideOffset={4}
      >
        {text}
        <Tooltip.Arrow class="fill-popover stroke-border" />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
