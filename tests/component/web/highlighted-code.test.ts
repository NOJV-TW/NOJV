// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { expect, it, vi } from "vitest";
import HighlightedCode from "$lib/components/primitives/ui/HighlightedCode.svelte";
import { MONACO_CODE_EDITOR_OPTIONS } from "$lib/utils/monaco-themes";

const monaco = vi.hoisted(() => {
  const editor = {
    onDidChangeModelContent: vi.fn(),
    dispose: vi.fn(),
    updateOptions: vi.fn(),
    getModel: vi.fn(),
    getValue: vi.fn(() => "def main():\n    return 42"),
  };
  return {
    instance: editor,
    editor: {
      create: vi.fn(() => editor),
      defineTheme: vi.fn(),
      setTheme: vi.fn(),
    },
  };
});

vi.mock("$lib/utils/monaco-loader", () => ({ loadMonaco: () => monaco }));

it("uses the workspace editor settings in read-only mode and follows the theme", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(HighlightedCode, {
    target,
    props: { code: "def main():\n    return 42", language: "python", maxHeight: "50vh" },
  });
  try {
    await vi.waitFor(() => expect(monaco.editor.create).toHaveBeenCalledOnce());
    expect(monaco.editor.create).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        ...MONACO_CODE_EDITOR_OPTIONS,
        language: "python",
        value: "def main():\n    return 42",
        readOnly: true,
        theme: "nojv-light",
      }),
    );
    expect(target.firstElementChild?.getAttribute("style")).toContain("height: 50vh");
    document.documentElement.classList.add("dark");
    await vi.waitFor(() =>
      expect(monaco.editor.setTheme).toHaveBeenLastCalledWith("nojv-dark"),
    );
  } finally {
    await unmount(component);
    document.documentElement.classList.remove("dark");
    target.remove();
  }
  expect(monaco.instance.dispose).toHaveBeenCalledOnce();
});
