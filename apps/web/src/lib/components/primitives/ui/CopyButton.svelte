<script lang="ts">
  import { onDestroy } from "svelte";
  import { Copy, Check } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/utils/css.js";

  interface Props {
    text: string;
    iconOnly?: boolean;
    class?: string | undefined;
  }

  let { text, iconOnly = false, class: className }: Props = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied = false), 2000);
  }

  onDestroy(() => clearTimeout(timer));
</script>

<button
  type="button"
  onclick={handleCopy}
  class={cn(
    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground",
    className,
  )}
  title={copied ? m.common_copied() : m.common_copy()}
  aria-label={copied ? m.common_copied() : m.common_copy()}
>
  {#if copied}
    <Check aria-hidden="true" class="size-3.5 text-primary" />
    {#if !iconOnly}<span class="text-primary">{m.common_copied()}</span>{/if}
  {:else}
    <Copy aria-hidden="true" class="size-3.5" />
    {#if !iconOnly}<span>{m.common_copy()}</span>{/if}
  {/if}
</button>
