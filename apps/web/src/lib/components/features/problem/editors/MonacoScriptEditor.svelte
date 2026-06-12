<script lang="ts">
  import type * as Monaco from "monaco-editor";
  import { onMount } from "svelte";
  import { getMonacoLanguage } from "$lib/utils/monaco-languages";
  import {
    defineNojvThemes,
    getNojvThemeName,
    MONACO_CODE_EDITOR_OPTIONS,
    watchThemeChanges,
  } from "$lib/utils/monaco-themes";

  interface Props {
    value: string;
    onchange?: (value: string) => void;
    language?: string;
    height?: string;
    isReadOnly?: boolean;
  }

  let {
    value,
    onchange,
    language = "python",
    height = "300px",
    isReadOnly = false,
  }: Props = $props();

  let editorContainer: HTMLDivElement;
  let monacoEditor: Monaco.editor.IStandaloneCodeEditor | undefined;
  let monacoModule: typeof Monaco | undefined;

  onMount(() => {
    let disposeTheme: (() => void) | undefined;

    void (async () => {
      const { loadMonaco } = await import("$lib/utils/monaco-loader");
      monacoModule = loadMonaco();
      defineNojvThemes(monacoModule);

      const isDark = document.documentElement.classList.contains("dark");
      monacoEditor = monacoModule.editor.create(editorContainer, {
        ...MONACO_CODE_EDITOR_OPTIONS,
        language: getMonacoLanguage(language),
        readOnly: isReadOnly,
        theme: getNojvThemeName(isDark),
        value,
      });

      monacoEditor.onDidChangeModelContent(() => {
        const current = monacoEditor!.getValue();
        onchange?.(current);
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
    if (!monacoEditor || !monacoModule) return;
    const model = monacoEditor.getModel();
    if (!model) return;
    monacoModule.editor.setModelLanguage(model, getMonacoLanguage(lang));
  });

  $effect(() => {
    const val = value;
    if (!monacoEditor) return;
    if (monacoEditor.getValue() !== val) {
      monacoEditor.setValue(val);
    }
  });

  $effect(() => {
    const ro = isReadOnly;
    if (!monacoEditor) return;
    monacoEditor.updateOptions({ readOnly: ro });
  });
</script>

<div bind:this={editorContainer} class="h-full w-full overflow-hidden" style:height></div>
