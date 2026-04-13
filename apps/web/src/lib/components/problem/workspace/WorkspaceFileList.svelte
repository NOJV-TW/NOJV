<script lang="ts">
  import type { WorkspaceFile } from "./WorkspaceFileEditor.svelte";
  import { m } from "$lib/paraglide/messages.js";

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

<div
  class="flex h-full min-h-[240px] flex-col gap-1 rounded-lg border border-border-subtle bg-[color:var(--color-panel)] p-2"
>
  <div class="mb-1 flex items-center justify-between px-2 pt-1">
    <span class="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
      {m.admin_files()}
    </span>
    <button
      type="button"
      class="inline-flex size-6 items-center justify-center rounded-lg text-body text-muted-foreground transition-[color,background-color] duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
      onclick={onadd}
      aria-label={m.admin_addFile()}
      title={m.admin_addFile()}
    >
      +
    </button>
  </div>

  {#if files.length > 0}
    <ul class="space-y-0.5">
      {#each files as file, index (`file-${String(index)}-${file.path}`)}
        <li>
          <button
            type="button"
            class="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-body-sm transition-[background-color,color] duration-fast ease-out-soft hover:bg-accent {selectedIndex ===
            index
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground'}"
            onclick={() => onselect(index)}
          >
            <span class="truncate font-mono text-caption">{file.path || "(unnamed)"}</span>
            <span class="ml-2 text-caption" aria-label={file.visibility} title={file.visibility}>
              {iconFor(file.visibility)}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
