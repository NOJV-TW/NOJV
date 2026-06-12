<script lang="ts">
  import type * as Monaco from "monaco-editor";
  import { onMount } from "svelte";
  import type { Language } from "@nojv/core";
  import {
    defineNojvThemes,
    getNojvThemeName,
    MONACO_CODE_EDITOR_OPTIONS,
    watchThemeChanges,
  } from "$lib/utils/monaco-themes";
  import { registerCompletionProviders } from "../editor-completions";

  interface Props {
    language: Language;
    drafts: Record<string, string>;
    isHidden?: boolean;
    onchange: (value: string) => void;
  }

  let { language, drafts, isHidden = false, onchange }: Props = $props();

  const editorOptions = {
    ...MONACO_CODE_EDITOR_OPTIONS,
    fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  };

  const languageIdMap: Record<string, string> = {
    c: "c",
    cpp: "cpp",
    go: "go",
    java: "java",
    javascript: "javascript",
    python: "python",
    rust: "rust",
    typescript: "typescript",
  };

  let editorContainer: HTMLDivElement = $state(null!);
  let monacoEditor: Monaco.editor.IStandaloneCodeEditor | undefined;
  let monacoModule: typeof Monaco | undefined;

  onMount(() => {
    let disposeTheme: (() => void) | undefined;

    void (async () => {
      const { loadMonaco } = await import("$lib/utils/monaco-loader");
      monacoModule = loadMonaco();
      registerCompletionProviders(monacoModule);
      defineNojvThemes(monacoModule);

      const isDark = document.documentElement.classList.contains("dark");
      monacoEditor = monacoModule.editor.create(editorContainer, {
        ...editorOptions,
        language: languageIdMap[language] ?? language,
        theme: getNojvThemeName(isDark),
        value: drafts[language] ?? "",
      });

      const editor = monacoEditor;
      editor.onDidChangeModelContent(() => {
        onchange(editor.getValue());
      });

      disposeTheme = watchThemeChanges(monacoModule);
    })();

    return () => {
      disposeTheme?.();
      monacoEditor?.dispose();
    };
  });

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

<div bind:this={editorContainer} class="h-full w-full" class:hidden={isHidden}></div>
