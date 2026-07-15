import type * as Monaco from "monaco-editor";

import {
  defineNojvThemes,
  getNojvThemeName,
  watchThemeChanges,
} from "$lib/utils/monaco-themes";

export interface PlagiarismDiffSources {
  original: string;
  modified: string;
}

interface PlagiarismDiffLifecycleOptions {
  container: HTMLDivElement;
  initialSources: PlagiarismDiffSources;
  loadMonaco: () => Promise<typeof Monaco>;
  onLoadError: (error: unknown) => void;
}

interface DiffResources {
  disposeTheme: () => void;
  editor: Monaco.editor.IStandaloneDiffEditor;
  modified: Monaco.editor.ITextModel;
  original: Monaco.editor.ITextModel;
}

function disposeResources(resources: DiffResources): void {
  resources.disposeTheme();
  resources.original.dispose();
  resources.modified.dispose();
  resources.editor.dispose();
}

function createResources(
  monaco: typeof Monaco,
  container: HTMLDivElement,
  sources: PlagiarismDiffSources,
): DiffResources {
  let editor: Monaco.editor.IStandaloneDiffEditor | undefined;
  let original: Monaco.editor.ITextModel | undefined;
  let modified: Monaco.editor.ITextModel | undefined;
  let disposeTheme: (() => void) | undefined;

  try {
    defineNojvThemes(monaco);
    editor = monaco.editor.createDiffEditor(container, {
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: true,
      theme: getNojvThemeName(
        typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
      ),
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    });
    original = monaco.editor.createModel(sources.original, "plaintext");
    modified = monaco.editor.createModel(sources.modified, "plaintext");
    editor.setModel({ original, modified });
    disposeTheme = watchThemeChanges(monaco);
    return { disposeTheme, editor, modified, original };
  } catch (error) {
    disposeTheme?.();
    original?.dispose();
    modified?.dispose();
    editor?.dispose();
    throw error;
  }
}

export function createPlagiarismDiffLifecycle({
  container,
  initialSources,
  loadMonaco,
  onLoadError,
}: PlagiarismDiffLifecycleOptions) {
  let generation = 0;
  let resources: DiffResources | undefined;
  let sources = initialSources;
  const initializationGeneration = ++generation;

  const ready = (async () => {
    try {
      const monaco = await loadMonaco();
      if (generation !== initializationGeneration) return;

      resources = createResources(monaco, container, sources);
    } catch (error) {
      if (generation === initializationGeneration) onLoadError(error);
    }
  })();

  return {
    ready,
    update(nextSources: PlagiarismDiffSources): void {
      if (generation !== initializationGeneration) return;
      sources = nextSources;
      resources?.original.setValue(nextSources.original);
      resources?.modified.setValue(nextSources.modified);
    },
    dispose(): void {
      if (generation !== initializationGeneration) return;
      generation++;
      if (!resources) return;
      disposeResources(resources);
      resources = undefined;
    },
  };
}
