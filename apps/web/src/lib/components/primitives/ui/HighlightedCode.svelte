<script lang="ts">
  import { highlightToLines, type HighlightToken } from "$lib/utils/highlight";

  interface Props {
    code: string;
    language?: string;
    maxHeight?: string | undefined;
  }

  let { code, language = "", maxHeight = undefined }: Props = $props();

  let lines = $derived(code.split("\n"));
  let displayLines = $derived(
    lines.length > 1 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines,
  );
  let gutterWidth = $derived(String(displayLines.length).length);

  let tokenLines = $state<HighlightToken[][] | null>(null);

  $effect(() => {
    const source = code;
    const lang = language;
    let cancelled = false;
    tokenLines = null;
    void highlightToLines(source, lang)
      .then((result) => {
        if (!cancelled) tokenLines = result;
      })
      .catch(() => {
        if (!cancelled) tokenLines = null;
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<div
  class="shiki-code h-full overflow-auto bg-[color:var(--color-panel)]"
  style={maxHeight ? `max-height: ${maxHeight}` : undefined}
>
  <table class="w-full border-collapse">
    <tbody>
      {#each displayLines as line, i (i)}
        <tr class="leading-6">
          <td
            class="select-none border-r border-border/50 px-3 text-right align-top font-mono text-xs text-muted-foreground/50"
            style="min-width: {gutterWidth + 1.5}ch"
          >
            {i + 1}
          </td>
          <td class="px-4 font-mono text-sm text-foreground">
            <pre
              class="whitespace-pre">{#if tokenLines && tokenLines[i] && tokenLines[i].length > 0}{#each tokenLines[i] as tok, ti (ti)}<span
                    class="tok"
                    style="--sl:{tok.light};--sd:{tok.dark}">{tok.content}</span
                  >{/each}{:else}{line || " "}{/if}</pre>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .shiki-code :global(.tok) {
    color: var(--sl);
  }
  :global(.dark) .shiki-code :global(.tok) {
    color: var(--sd);
  }
</style>
