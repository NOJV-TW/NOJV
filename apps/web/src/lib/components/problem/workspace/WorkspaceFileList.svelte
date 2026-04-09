<script lang="ts">
  import type { WorkspaceFile } from "./WorkspaceFileEditor.svelte";

  interface Props {
    files: WorkspaceFile[];
    selectedIndex: number;
    onselect: (index: number) => void;
    onadd: () => void;
  }

  let { files, selectedIndex, onselect, onadd }: Props = $props();

  function iconFor(visibility: WorkspaceFile["visibility"]): string {
    if (visibility === "editable") return "✎";
    if (visibility === "readonly") return "🔒";
    return "👁";
  }
</script>

<div class="flex h-full flex-col gap-1 rounded-xl border border-border bg-[color:var(--color-panel)] p-2">
  <div class="mb-1 flex items-center justify-between px-2 pt-1">
    <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      Files
    </span>
    <button
      type="button"
      class="rounded text-xs text-muted-foreground hover:text-foreground"
      onclick={onadd}
      aria-label="Add file"
    >
      + Add
    </button>
  </div>

  {#if files.length === 0}
    <div class="px-2 py-3 text-center text-xs text-muted-foreground">
      No files yet.
    </div>
  {:else}
    <ul class="space-y-0.5">
      {#each files as file, index (`file-${index}-${file.path}`)}
        <li>
          <button
            type="button"
            class="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-accent {selectedIndex ===
            index
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground'}"
            onclick={() => onselect(index)}
          >
            <span class="truncate font-mono text-xs">{file.path || "(unnamed)"}</span>
            <span class="ml-2 text-xs" aria-label={file.visibility} title={file.visibility}>
              {iconFor(file.visibility)}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
