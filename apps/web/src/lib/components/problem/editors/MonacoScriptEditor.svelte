<script lang="ts">
  import type * as Monaco from "monaco-editor";
  import { onMount } from "svelte";
  import { getMonacoLanguage } from "$lib/utils/monaco-languages";
  import { defineNojvThemes, getNojvThemeName } from "$lib/utils/monaco-themes";

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

  onMount(() => {
    let themeObserver: MutationObserver | undefined;

    void (async () => {
      monacoModule = await import("monaco-editor");
      defineNojvThemes(monacoModule);

      const isDark = document.documentElement.classList.contains("dark");
      monacoEditor = monacoModule.editor.create(editorContainer, {
        automaticLayout: true,
        fontSize: 12,
        hideCursorInOverviewRuler: true,
        language: getMonacoLanguage(language),
        lineDecorationsWidth: 0,
        lineNumbersMinChars: 2,
        minimap: { enabled: false },
        overviewRulerBorder: false,
        padding: { top: 16 },
        readOnly: readonly,
        scrollBeyondLastLine: false,
        theme: getNojvThemeName(isDark),
        value,
        wordWrap: "on",
      });

      monacoEditor.onDidChangeModelContent(() => {
        const current = monacoEditor!.getValue();
        onchange?.(current);
      });

      themeObserver = new MutationObserver(() => {
        const dark = document.documentElement.classList.contains("dark");
        monacoModule!.editor.setTheme(getNojvThemeName(dark));
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
    monacoModule.editor.setModelLanguage(model, getMonacoLanguage(lang));
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
  class="h-full w-full overflow-hidden"
  style:height
></div>
