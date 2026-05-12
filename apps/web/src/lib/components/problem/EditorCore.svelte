<script lang="ts">
  import type * as Monaco from "monaco-editor";
  import { onMount } from "svelte";
  import type { Language } from "@nojv/core";
  import { defineNojvThemes, getNojvThemeName } from "$lib/utils/monaco-themes";
  import { registerCompletionProviders } from "./editor-completions";

  interface Props {
    /** Current language — drives Monaco model language + the buffer we sync. */
    language: Language;
    /** Per-language draft map. `value` for the current language is what we mirror. */
    drafts: Record<string, string>;
    /** Hide the underlying container without disposing Monaco. */
    hidden?: boolean;
    /** Fires with the latest buffer whenever the student edits code. */
    onchange: (value: string) => void;
  }

  let { language, drafts, hidden = false, onchange }: Props = $props();

  const editorOptions = {
    automaticLayout: true,
    fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    hideCursorInOverviewRuler: true,
    lineDecorationsWidth: 0,
    lineNumbersMinChars: 2,
    minimap: { enabled: false },
    overviewRulerBorder: false,
    padding: { top: 16 },
    scrollBeyondLastLine: false,
    wordWrap: "on" as const
  };

  // Monaco uses its own language ids for a couple of our slugs — everything
  // else maps 1:1, but we keep the table explicit so future additions are
  // obvious.
  const languageIdMap: Record<string, string> = {
    c: "c",
    cpp: "cpp",
    go: "go",
    java: "java",
    javascript: "javascript",
    python: "python",
    rust: "rust",
    typescript: "typescript"
  };

  let editorContainer: HTMLDivElement = $state(null!);
  let monacoEditor: Monaco.editor.IStandaloneCodeEditor | undefined;
  let monacoModule: typeof Monaco | undefined;

  onMount(() => {
    let themeObserver: MutationObserver | undefined;

    void (async () => {
      monacoModule = await import("monaco-editor");
      registerCompletionProviders(monacoModule);
      defineNojvThemes(monacoModule);

      const isDark = document.documentElement.classList.contains("dark");
      monacoEditor = monacoModule.editor.create(editorContainer, {
        ...editorOptions,
        language: languageIdMap[language] ?? language,
        theme: getNojvThemeName(isDark),
        value: drafts[language] ?? ""
      });

      const editor = monacoEditor;
      editor.onDidChangeModelContent(() => {
        onchange(editor.getValue());
      });

      // Watch for dark mode toggling on <html> so the editor theme tracks
      // the global theme without a full reload.
      themeObserver = new MutationObserver(() => {
        const dark = document.documentElement.classList.contains("dark");
        monacoModule!.editor.setTheme(getNojvThemeName(dark));
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"]
      });
    })();

    return () => {
      themeObserver?.disconnect();
      monacoEditor?.dispose();
    };
  });

  // Keep Monaco in sync with external changes to `language` / `drafts`:
  //  - reassign the model language when the student switches languages
  //  - push the new draft into the buffer only when it actually differs
  //    (prevents an infinite loop with `onDidChangeModelContent`)
  $effect(() => {
    const lang = language;
    const draft = drafts[lang] ?? "";
    if (!monacoEditor || !monacoModule) return;
    const model = monacoEditor.getModel();
    if (!model) return;
    monacoModule.editor.setModelLanguage(model, languageIdMap[lang] ?? lang);
    if (monacoEditor.getValue() !== draft) {
      monacoEditor.setValue(draft);
    }
  });
</script>

<div bind:this={editorContainer} class="h-full w-full" class:hidden></div>
