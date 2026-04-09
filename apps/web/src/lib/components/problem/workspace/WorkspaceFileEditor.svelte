<script lang="ts">
  import type { Language } from "@nojv/core";
  import { inputClassName } from "$lib/utils";
  import MonacoEditableRegions from "./MonacoEditableRegions.svelte";

  export interface WorkspaceFile {
    path: string;
    content: string;
    visibility: "editable" | "readonly" | "hidden";
    editableRegions: [number, number][] | null;
  }

  interface Props {
    file: WorkspaceFile;
    language: Language;
    onchange?: (file: WorkspaceFile) => void;
    ondelete?: () => void;
  }

  let { file, language, onchange, ondelete }: Props = $props();

  function update(partial: Partial<WorkspaceFile>) {
    onchange?.({ ...file, ...partial });
  }

  // Parse a region string like "10-15, 25-40" into tuples.
  let regionsText = $state(
    (file.editableRegions ?? []).map(([a, b]) => `${a}-${b}`).join(", ")
  );

  function parseRegions(text: string): [number, number][] | null {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    const parts = trimmed.split(",").map((p) => p.trim()).filter((p) => p !== "");
    const result: [number, number][] = [];
    for (const part of parts) {
      const m = /^(\d+)-(\d+)$/.exec(part);
      if (!m) return null;
      const start = parseInt(m[1]!, 10);
      const end = parseInt(m[2]!, 10);
      if (start < 1 || end < start) return null;
      result.push([start, end]);
    }
    return result;
  }

  function commitRegions() {
    const parsed = parseRegions(regionsText);
    update({ editableRegions: parsed });
  }
</script>

<div class="space-y-3">
  <div class="grid gap-3 md:grid-cols-[1fr_auto_auto]">
    <label class="text-xs text-muted-foreground">
      <span>Path</span>
      <input
        class={inputClassName}
        type="text"
        placeholder="main.c or include/header.h"
        value={file.path}
        oninput={(e) => update({ path: (e.target as HTMLInputElement).value })}
      />
    </label>
    <label class="text-xs text-muted-foreground">
      <span>Visibility</span>
      <select
        class="{inputClassName} mt-0"
        value={file.visibility}
        onchange={(e) => {
          const v = (e.target as HTMLSelectElement).value as WorkspaceFile["visibility"];
          update({ visibility: v });
        }}
      >
        <option value="editable">Editable</option>
        <option value="readonly">Read-only</option>
        <option value="hidden">Hidden</option>
      </select>
    </label>
    <button
      type="button"
      class="self-end rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-red-400 hover:text-red-500"
      onclick={() => ondelete?.()}
    >
      Delete
    </button>
  </div>

  {#if file.visibility === "editable"}
    <label class="text-xs text-muted-foreground">
      <span>
        Editable regions (optional, e.g. "10-15, 25-40")
        — leave blank to allow editing the whole file
      </span>
      <input
        class={inputClassName}
        type="text"
        placeholder="10-15, 25-40"
        bind:value={regionsText}
        onblur={commitRegions}
      />
    </label>
  {/if}

  <MonacoEditableRegions
    value={file.content}
    onchange={(v) => update({ content: v })}
    {language}
    editableRegions={null}
    readonly={false}
    height="360px"
  />
</div>
