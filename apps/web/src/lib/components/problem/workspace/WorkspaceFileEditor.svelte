<script lang="ts">
  import type { Language } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { inputClassName } from "$lib/utils";
  import MonacoScriptEditor from "$lib/components/problem/editors/MonacoScriptEditor.svelte";

  export interface WorkspaceFile {
    path: string;
    content: string;
    description: string;
    visibility: "editable" | "readonly" | "hidden";
    orderIndex: number;
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
</script>

<div class="space-y-3">
  <div class="grid gap-3 md:grid-cols-[1fr_auto_auto]">
    <label class="text-caption text-muted-foreground">
      <span>Path</span>
      <input
        class={inputClassName}
        type="text"
        placeholder="main.c or include/header.h"
        value={file.path}
        oninput={(e) => update({ path: (e.target as HTMLInputElement).value })}
      />
    </label>
    <label class="text-caption text-muted-foreground">
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
      class="self-end rounded-lg border border-border px-3 py-1.5 text-caption text-muted-foreground transition-[color,border-color] duration-fast ease-out-soft hover:border-destructive hover:text-destructive"
      onclick={() => ondelete?.()}
    >
      Delete
    </button>
  </div>

  <label class="block text-caption text-muted-foreground">
    <span>{m.workspace_description()}</span>
    <textarea
      class={inputClassName}
      rows="2"
      maxlength="5000"
      placeholder={m.workspace_descriptionPlaceholder()}
      value={file.description}
      oninput={(e) => update({ description: (e.target as HTMLTextAreaElement).value })}
    ></textarea>
  </label>

  <MonacoScriptEditor
    value={file.content}
    onchange={(v) => update({ content: v })}
    {language}
    readonly={false}
    height="360px"
  />
</div>
