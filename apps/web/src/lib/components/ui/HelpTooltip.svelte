<script lang="ts">
  import { Tooltip } from "bits-ui";
  import { CircleHelp } from "@lucide/svelte";

  interface Props {
    text: string;
  }

  let { text }: Props = $props();
</script>

<Tooltip.Provider delayDuration={200}>
  <Tooltip.Root>
    <Tooltip.Trigger
      class="inline-flex cursor-help items-center text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      type="button"
      onclick={(e: MouseEvent) => e.preventDefault()}
    >
      <CircleHelp class="size-3.5" />
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        class="z-50 max-w-xs whitespace-pre-line rounded-xl border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
        sideOffset={4}
      >
        {text}
        <Tooltip.Arrow class="fill-popover stroke-border" />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
