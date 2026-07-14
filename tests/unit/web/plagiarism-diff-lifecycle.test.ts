import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";

const theme = vi.hoisted(() => ({
  define: vi.fn(),
  dispose: vi.fn(),
  watch: vi.fn(),
}));

vi.mock("$lib/utils/monaco-themes", () => ({
  defineNojvThemes: theme.define,
  getNojvThemeName: vi.fn(() => "nojv-light"),
  watchThemeChanges: theme.watch,
}));

import { createPlagiarismDiffLifecycle } from "$lib/components/features/plagiarism/plagiarism-diff-lifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createMonaco() {
  const original = { dispose: vi.fn(), setValue: vi.fn() };
  const modified = { dispose: vi.fn(), setValue: vi.fn() };
  const editor = { dispose: vi.fn(), setModel: vi.fn() };
  const createModel = vi.fn().mockReturnValueOnce(original).mockReturnValueOnce(modified);
  const createDiffEditor = vi.fn(() => editor);

  return {
    createDiffEditor,
    createModel,
    editor,
    modified,
    module: { editor: { createDiffEditor, createModel } } as never,
    original,
  };
}

describe("plagiarism diff editor lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    theme.watch.mockReturnValue(theme.dispose);
  });

  it("uses the newest sources when data changes while Monaco is loading", async () => {
    const loading = deferred<typeof Monaco>();
    const monaco = createMonaco();
    const lifecycle = createPlagiarismDiffLifecycle({
      container: {} as HTMLDivElement,
      initialSources: { original: "pair A left", modified: "pair A right" },
      loadMonaco: () => loading.promise,
      onLoadError: vi.fn(),
    });

    lifecycle.update({ original: "pair B left", modified: "pair B right" });
    loading.resolve(monaco.module);
    await lifecycle.ready;

    expect(monaco.createModel).toHaveBeenNthCalledWith(1, "pair B left", "plaintext");
    expect(monaco.createModel).toHaveBeenNthCalledWith(2, "pair B right", "plaintext");

    lifecycle.update({ original: "pair C left", modified: "pair C right" });
    expect(monaco.original.setValue).toHaveBeenLastCalledWith("pair C left");
    expect(monaco.modified.setValue).toHaveBeenLastCalledWith("pair C right");
  });

  it("does not create resources or publish an error after disposal", async () => {
    const loading = deferred<typeof Monaco>();
    const monaco = createMonaco();
    const onLoadError = vi.fn();
    const lifecycle = createPlagiarismDiffLifecycle({
      container: {} as HTMLDivElement,
      initialSources: { original: "left", modified: "right" },
      loadMonaco: () => loading.promise,
      onLoadError,
    });

    lifecycle.dispose();
    lifecycle.update({ original: "stale left", modified: "stale right" });
    loading.resolve(monaco.module);
    await lifecycle.ready;

    expect(monaco.createDiffEditor).not.toHaveBeenCalled();
    expect(onLoadError).not.toHaveBeenCalled();
  });

  it("disposes the theme watcher, both models, and editor exactly once", async () => {
    const monaco = createMonaco();
    const lifecycle = createPlagiarismDiffLifecycle({
      container: {} as HTMLDivElement,
      initialSources: { original: "left", modified: "right" },
      loadMonaco: async () => monaco.module,
      onLoadError: vi.fn(),
    });
    await lifecycle.ready;

    lifecycle.dispose();
    lifecycle.dispose();

    expect(theme.dispose).toHaveBeenCalledOnce();
    expect(monaco.original.dispose).toHaveBeenCalledOnce();
    expect(monaco.modified.dispose).toHaveBeenCalledOnce();
    expect(monaco.editor.dispose).toHaveBeenCalledOnce();
  });

  it("reports an active Monaco load failure without creating resources", async () => {
    const loading = deferred<typeof Monaco>();
    const onLoadError = vi.fn();
    const lifecycle = createPlagiarismDiffLifecycle({
      container: {} as HTMLDivElement,
      initialSources: { original: "left", modified: "right" },
      loadMonaco: () => loading.promise,
      onLoadError,
    });
    const failure = new Error("chunk unavailable");

    loading.reject(failure);
    await lifecycle.ready;

    expect(onLoadError).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it("cleans up partially created resources when initialization fails", async () => {
    const monaco = createMonaco();
    const failure = new Error("theme watcher failed");
    const onLoadError = vi.fn();
    theme.watch.mockImplementationOnce(() => {
      throw failure;
    });
    const lifecycle = createPlagiarismDiffLifecycle({
      container: {} as HTMLDivElement,
      initialSources: { original: "left", modified: "right" },
      loadMonaco: async () => monaco.module,
      onLoadError,
    });

    await lifecycle.ready;
    lifecycle.dispose();

    expect(onLoadError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(monaco.original.dispose).toHaveBeenCalledOnce();
    expect(monaco.modified.dispose).toHaveBeenCalledOnce();
    expect(monaco.editor.dispose).toHaveBeenCalledOnce();
  });
});
