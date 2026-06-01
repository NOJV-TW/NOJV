<script lang="ts">
  import { Copy, Check } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import HighlightedCode from "./HighlightedCode.svelte";

  interface Props {
    code: string;
    language?: string;
    maxHeight?: string;
  }

  let { code, language = "", maxHeight = "50vh" }: Props = $props();

  let isCopied = $state(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    isCopied = true;
    setTimeout(() => {
      isCopied = false;
    }, 2000);
  }
</script>

<div class="overflow-hidden rounded-lg border border-border">
  <div class="flex items-center justify-between bg-muted/60 px-4 py-2">
    {#if language}
      <span class="text-xs font-medium text-muted-foreground">{language}</span>
    {:else}
      <span></span>
    {/if}
    <button
      class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
      onclick={handleCopy}
      type="button"
    >
      {#if isCopied}
        <Check aria-hidden="true" class="h-3.5 w-3.5 text-emerald-500" />
        <span class="text-emerald-500">{m.common_copied()}</span>
      {:else}
        <Copy aria-hidden="true" class="h-3.5 w-3.5" />
        <span>{m.common_copy()}</span>
      {/if}
    </button>
  </div>
  <HighlightedCode {code} {language} {maxHeight} />
</div>
