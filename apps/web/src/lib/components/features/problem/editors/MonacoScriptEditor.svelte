<script lang="ts">
  import type * as Monaco from "monaco-editor";
  import { onMount } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
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
  let editorLoadFailed = $state(false);

  onMount(() => {
    let active = true;
    let disposeTheme: (() => void) | undefined;

    void (async () => {
      try {
        const { loadMonaco } = await import("$lib/utils/monaco-loader");
        if (!active) return;
        const monaco = loadMonaco();
        monacoModule = monaco;
        defineNojvThemes(monaco);

        const isDark = document.documentElement.classList.contains("dark");
        const editor = monaco.editor.create(editorContainer, {
          ...MONACO_CODE_EDITOR_OPTIONS,
          language: getMonacoLanguage(language),
          readOnly: isReadOnly,
          theme: getNojvThemeName(isDark),
          value,
        });
        monacoEditor = editor;

        editor.onDidChangeModelContent(() => {
          if (active) onchange?.(editor.getValue());
        });

        disposeTheme = watchThemeChanges(monaco);
      } catch {
        disposeTheme?.();
        disposeTheme = undefined;
        monacoEditor?.dispose();
        monacoEditor = undefined;
        monacoModule = undefined;
        if (active) editorLoadFailed = true;
      }
    })();

    return () => {
      active = false;
      disposeTheme?.();
      monacoEditor?.dispose();
      monacoEditor = undefined;
      monacoModule = undefined;
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

<div class="relative h-full w-full" style:height>
  <div bind:this={editorContainer} class="h-full w-full overflow-hidden"></div>
  {#if editorLoadFailed}
    <div
      class="absolute inset-0 flex items-center justify-center bg-[color:var(--color-panel)] px-4 text-body-sm text-destructive"
      role="alert"
    >
      {m.editor_loadFailed()}
    </div>
  {/if}
</div>
