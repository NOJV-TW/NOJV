<script lang="ts">
  import type * as Monaco from "monaco-editor";
  import { onMount } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { getMonacoLanguage } from "$lib/utils/monaco-languages";

  export interface FileEntry {
    path: string;
    content: string;
  }

  interface Props {
    files: FileEntry[];
    onchange?: (files: FileEntry[]) => void;
    readonly?: boolean;
  }

  let { files = $bindable(), onchange, readonly = false }: Props = $props();

  let selectedIndex = $state(0);
  let editorContainer: HTMLDivElement;
  let monacoEditor: Monaco.editor.IStandaloneCodeEditor | undefined;
  let monacoModule: typeof Monaco | undefined;

  // Language detection from file extension
  function detectLanguage(path: string): string {
    // Handle Makefile (no extension)
    const basename = path.split("/").pop()?.toLowerCase() ?? "";
    if (basename === "makefile") return "makefile";
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    return getMonacoLanguage(ext);
  }

  function emitChange() {
    onchange?.(files);
  }

  function addFile() {
    const name = prompt("File name (e.g. src/main.c):");
    if (!name || name.trim().length === 0) return;
    const trimmed = name.trim();
    if (files.some((f) => f.path === trimmed)) {
      alert(`File "${trimmed}" already exists.`);
      return;
    }
    files = [...files, { path: trimmed, content: "" }];
    selectedIndex = files.length - 1;
    emitChange();
  }

  function deleteFile(index: number) {
    if (files.length <= 1) return;
    files = files.filter((_, i) => i !== index);
    if (selectedIndex >= files.length) {
      selectedIndex = files.length - 1;
    }
    emitChange();
  }

  function selectFile(index: number) {
    // Save current content before switching
    if (monacoEditor && files[selectedIndex]) {
      const currentContent = monacoEditor.getValue();
      if (files[selectedIndex].content !== currentContent) {
        files = files.map((f, i) =>
          i === selectedIndex ? { ...f, content: currentContent } : f
        );
        emitChange();
      }
    }
    selectedIndex = index;
  }

  async function handleUploadZip() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file);
      const newFiles: FileEntry[] = [];
      const promises: Promise<void>[] = [];
      zip.forEach((relativePath, zipEntry) => {
        if (zipEntry.dir) return;
        // Skip hidden files and __MACOSX
        if (relativePath.startsWith("__MACOSX") || relativePath.startsWith(".")) return;
        promises.push(
          zipEntry.async("string").then((content) => {
            newFiles.push({ path: relativePath, content });
          })
        );
      });
      await Promise.all(promises);
      newFiles.sort((a, b) => a.path.localeCompare(b.path));
      if (newFiles.length > 0) {
        files = newFiles;
        selectedIndex = 0;
        emitChange();
      }
    };
    input.click();
  }

  onMount(() => {
    let themeObserver: MutationObserver | undefined;

    void (async () => {
      monacoModule = await import("monaco-editor");

      const isDark = document.documentElement.classList.contains("dark");
      monacoEditor = monacoModule.editor.create(editorContainer, {
        automaticLayout: true,
        fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 14,
        language: detectLanguage(files[selectedIndex]?.path ?? ""),
        minimap: { enabled: false },
        padding: { top: 12 },
        readOnly: readonly,
        scrollBeyondLastLine: false,
        theme: isDark ? "vs-dark" : "vs-light",
        value: files[selectedIndex]?.content ?? "",
        wordWrap: "on" as const,
      });

      monacoEditor.onDidChangeModelContent(() => {
        if (!monacoEditor || readonly) return;
        const newContent = monacoEditor.getValue();
        if (files[selectedIndex] && files[selectedIndex].content !== newContent) {
          files = files.map((f, i) =>
            i === selectedIndex ? { ...f, content: newContent } : f
          );
          emitChange();
        }
      });

      themeObserver = new MutationObserver(() => {
        const dark = document.documentElement.classList.contains("dark");
        monacoModule!.editor.setTheme(dark ? "vs-dark" : "vs-light");
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
    })();

    return () => {
      themeObserver?.disconnect();
      monacoEditor?.dispose();
    };
  });

  // Sync editor content and language when selected file changes
  $effect(() => {
    const idx = selectedIndex;
    const file = files[idx];
    if (!monacoEditor || !monacoModule || !file) return;
    const model = monacoEditor.getModel();
    if (!model) return;
    monacoModule.editor.setModelLanguage(model, detectLanguage(file.path));
    if (monacoEditor.getValue() !== file.content) {
      monacoEditor.setValue(file.content);
    }
  });
</script>

<div class="flex h-full overflow-hidden rounded-2xl border border-border">
  <!-- File list sidebar -->
  <div class="flex w-52 flex-col border-r border-border bg-muted">
    <div class="flex items-center justify-between border-b border-border px-3 py-2">
      <span class="text-xs font-medium text-muted-foreground">{m.common_files()}</span>
      {#if !readonly}
        <div class="flex gap-1">
          <button
            class="rounded px-1.5 py-0.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
            onclick={handleUploadZip}
            type="button"
            title="Upload ZIP"
          >
            ZIP
          </button>
          <button
            class="rounded px-1.5 py-0.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
            onclick={addFile}
            type="button"
            title="Add file"
          >
            +
          </button>
        </div>
      {/if}
    </div>
    <div class="flex-1 overflow-y-auto">
      {#each files as file, index (file.path)}
        <button
          class="group flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition
            {selectedIndex === index
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
          onclick={() => selectFile(index)}
          type="button"
        >
          <span class="truncate" title={file.path}>{file.path}</span>
          {#if !readonly && files.length > 1}
            <span
              class="ml-1 hidden shrink-0 text-muted-foreground hover:text-red-500 group-hover:inline"
              role="button"
              tabindex="-1"
              onclick={(e) => { e.stopPropagation(); deleteFile(index); }}
              onkeydown={() => {}}
            >
              &times;
            </span>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <!-- Monaco editor -->
  <div class="min-w-0 flex-1">
    <div bind:this={editorContainer} class="h-full w-full"></div>
  </div>
</div>
