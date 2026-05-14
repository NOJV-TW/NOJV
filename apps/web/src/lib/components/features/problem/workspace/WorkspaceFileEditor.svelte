<script lang="ts">
  import type { Language } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { inputClassName } from "$lib/utils/css";
  import MonacoScriptEditor from "$lib/components/features/problem/editors/MonacoScriptEditor.svelte";

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
      <span>{m.admin_filePath()}</span>
      <input
        class={inputClassName}
        type="text"
        placeholder={m.admin_filePathPlaceholder()}
        value={file.path}
        oninput={(e) => update({ path: (e.target as HTMLInputElement).value })}
      />
    </label>
    <label class="text-caption text-muted-foreground">
      <span>{m.admin_fileVisibility()}</span>
      <select
        class="{inputClassName} mt-0"
        value={file.visibility}
        onchange={(e) => {
          const v = (e.target as HTMLSelectElement).value as WorkspaceFile["visibility"];
          update({ visibility: v });
        }}
      >
        <option value="editable">{m.admin_fileEditable()}</option>
        <option value="readonly">{m.admin_fileReadonly()}</option>
        <option value="hidden">{m.admin_fileHidden()}</option>
      </select>
    </label>
    <button
      type="button"
      class="self-end rounded-md border border-border px-3 py-1.5 text-caption text-muted-foreground transition-[color,border-color] duration-fast ease-out-soft hover:border-destructive hover:text-destructive"
      onclick={() => ondelete?.()}
    >
      {m.common_delete()}
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
    isReadOnly={false}
    height="360px"
  />
</div>
