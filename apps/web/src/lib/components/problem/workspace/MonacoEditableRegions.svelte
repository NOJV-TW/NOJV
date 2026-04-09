<script lang="ts">
  import type * as Monaco from "monaco-editor";
  import { onMount } from "svelte";
  import { getMonacoLanguage } from "$lib/utils/monaco-languages";

  interface Props {
    value: string;
    onchange?: (value: string) => void;
    language?: string;
    height?: string;
    readonly?: boolean;
    /**
     * Line ranges (1-indexed, inclusive) the user is allowed to edit.
     * `null` or omitted means the entire document is editable.
     */
    editableRegions?: [number, number][] | null;
  }

  let {
    value,
    onchange,
    language = "plaintext",
    height = "320px",
    readonly = false,
    editableRegions = null
  }: Props = $props();

  let editorContainer: HTMLDivElement;
  let monacoEditor: Monaco.editor.IStandaloneCodeEditor | undefined;
  let monacoModule: typeof Monaco | undefined;
  let decorationCollection: Monaco.editor.IEditorDecorationsCollection | undefined;
  let changeListener: Monaco.IDisposable | undefined;
  let willTypeListener: Monaco.IDisposable | undefined;

  function isLineEditable(line: number, regions: [number, number][] | null): boolean {
    if (!regions || regions.length === 0) return true;
    return regions.some(([start, end]) => line >= start && line <= end);
  }

  function applyDecorations() {
    if (!monacoEditor || !monacoModule) return;
    const model = monacoEditor.getModel();
    if (!model) return;

    decorationCollection?.clear();
    if (!editableRegions || editableRegions.length === 0) return;

    const lineCount = model.getLineCount();
    const decorations: Monaco.editor.IModelDeltaDecoration[] = [];
    for (const [start, end] of editableRegions) {
      decorations.push({
        range: new monacoModule.Range(start, 1, Math.min(end, lineCount), 1),
        options: {
          className: "monaco-editable-region",
          isWholeLine: true,
          linesDecorationsClassName: "monaco-editable-region-gutter"
        }
      });
    }
    decorationCollection = monacoEditor.createDecorationsCollection(decorations);
  }

  onMount(() => {
    let themeObserver: MutationObserver | undefined;

    void (async () => {
      monacoModule = await import("monaco-editor");
      const isDark = document.documentElement.classList.contains("dark");

      monacoEditor = monacoModule.editor.create(editorContainer, {
        automaticLayout: true,
        fontSize: 14,
        language: getMonacoLanguage(language),
        minimap: { enabled: false },
        padding: { top: 12 },
        readOnly: readonly,
        scrollBeyondLastLine: false,
        theme: isDark ? "vs-dark" : "vs-light",
        value,
        wordWrap: "on"
      });

      // When the user starts typing, refuse changes that fall outside
      // of the declared editable regions. We snapshot the value before
      // the change and roll back on violation.
      let snapshot = value;
      let guarding = false;
      changeListener = monacoEditor.onDidChangeModelContent((ev) => {
        if (guarding) return;
        if (!editableRegions || editableRegions.length === 0) {
          snapshot = monacoEditor!.getValue();
          onchange?.(snapshot);
          return;
        }

        const invalid = ev.changes.some((change) => {
          for (
            let line = change.range.startLineNumber;
            line <= change.range.endLineNumber;
            line++
          ) {
            if (!isLineEditable(line, editableRegions)) return true;
          }
          return false;
        });

        if (invalid) {
          guarding = true;
          monacoEditor!.setValue(snapshot);
          guarding = false;
          return;
        }

        snapshot = monacoEditor!.getValue();
        onchange?.(snapshot);
      });

      applyDecorations();

      themeObserver = new MutationObserver(() => {
        const dark = document.documentElement.classList.contains("dark");
        monacoModule!.editor.setTheme(dark ? "vs-dark" : "vs-light");
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"]
      });
    })();

    return () => {
      themeObserver?.disconnect();
      changeListener?.dispose();
      willTypeListener?.dispose();
      decorationCollection?.clear();
      monacoEditor?.dispose();
    };
  });

  // Sync language
  $effect(() => {
    const lang = language;
    if (!monacoEditor || !monacoModule) return;
    const model = monacoEditor.getModel();
    if (!model) return;
    monacoModule.editor.setModelLanguage(model, getMonacoLanguage(lang));
  });

  // Sync value from props
  $effect(() => {
    const val = value;
    if (!monacoEditor) return;
    if (monacoEditor.getValue() !== val) {
      monacoEditor.setValue(val);
    }
  });

  // Sync readonly
  $effect(() => {
    const ro = readonly;
    if (!monacoEditor) return;
    monacoEditor.updateOptions({ readOnly: ro });
  });

  // Sync decorations when regions change
  $effect(() => {
    void editableRegions;
    applyDecorations();
  });
</script>

<div
  bind:this={editorContainer}
  class="w-full overflow-hidden rounded-xl border border-border"
  style:height
></div>

<style>
  :global(.monaco-editable-region) {
    background-color: rgba(52, 211, 153, 0.08);
  }
  :global(.monaco-editable-region-gutter) {
    background-color: rgba(52, 211, 153, 0.6);
    width: 3px !important;
    margin-left: 2px;
  }
</style>
