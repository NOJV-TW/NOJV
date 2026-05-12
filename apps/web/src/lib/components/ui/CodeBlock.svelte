<script lang="ts">
  import { Copy, Check } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    code: string;
    language?: string;
    maxHeight?: string;
  }

  let { code, language = "", maxHeight = "50vh" }: Props = $props();

  let copied = $state(false);

  let lines = $derived(code.split("\n"));
  let displayLines = $derived(
    lines.length > 1 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines
  );
  let gutterWidth = $derived(String(displayLines.length).length);

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    copied = true;
    setTimeout(() => {
      copied = false;
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
      {#if copied}
        <Check class="h-3.5 w-3.5 text-emerald-500" />
        <span class="text-emerald-500">{m.common_copied()}</span>
      {:else}
        <Copy class="h-3.5 w-3.5" />
        <span>{m.common_copy()}</span>
      {/if}
    </button>
  </div>
  <div class="overflow-auto bg-[color:var(--color-panel)]" style="max-height: {maxHeight}">
    <table class="w-full border-collapse">
      <tbody>
        {#each displayLines as line, i (i)}
          <tr class="leading-6">
            <td
              class="select-none border-r border-border/50 px-3 text-right font-mono text-xs text-muted-foreground/50"
              style="min-width: {gutterWidth + 1.5}ch"
            >
              {i + 1}
            </td>
            <td class="px-4 font-mono text-sm text-foreground">
              <pre class="whitespace-pre-wrap break-all">{line || " "}</pre>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
