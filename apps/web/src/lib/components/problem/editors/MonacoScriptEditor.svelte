<script lang="ts">
  import type * as Monaco from "monaco-editor";
  import { onMount } from "svelte";

  interface Props {
    value: string;
    onchange?: (value: string) => void;
    language?: string;
    height?: string;
    readonly?: boolean;
  }

  let {
    value,
    onchange,
    language = "python",
    height = "300px",
    readonly = false,
  }: Props = $props();

  let editorContainer: HTMLDivElement;
  let monacoEditor: Monaco.editor.IStandaloneCodeEditor | undefined;
  let monacoModule: typeof Monaco | undefined;

  const langMap: Record<string, string> = {
    c: "c",
    cpp: "cpp",
    go: "go",
    javascript: "javascript",
    python: "python",
    rust: "rust",
  };

  onMount(() => {
    let themeObserver: MutationObserver | undefined;

    void (async () => {
      monacoModule = await import("monaco-editor");

      const isDark = document.documentElement.classList.contains("dark");
      monacoEditor = monacoModule.editor.create(editorContainer, {
        automaticLayout: true,
        fontSize: 14,
        language: langMap[language] ?? language,
        minimap: { enabled: false },
        padding: { top: 16 },
        readOnly: readonly,
        scrollBeyondLastLine: false,
        theme: isDark ? "vs-dark" : "vs-light",
        value,
        wordWrap: "on",
      });

      monacoEditor.onDidChangeModelContent(() => {
        const current = monacoEditor!.getValue();
        onchange?.(current);
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

  // Sync language changes
  $effect(() => {
    const lang = language;
    if (!monacoEditor || !monacoModule) return;
    const model = monacoEditor.getModel();
    if (!model) return;
    monacoModule.editor.setModelLanguage(model, langMap[lang] ?? lang);
  });

  // Sync value changes from outside (avoid loop by checking current value)
  $effect(() => {
    const val = value;
    if (!monacoEditor) return;
    if (monacoEditor.getValue() !== val) {
      monacoEditor.setValue(val);
    }
  });

  // Sync readonly changes
  $effect(() => {
    const ro = readonly;
    if (!monacoEditor) return;
    monacoEditor.updateOptions({ readOnly: ro });
  });
</script>

<div
  bind:this={editorContainer}
  class="w-full overflow-hidden rounded-xl border border-border"
  style:height
></div>
