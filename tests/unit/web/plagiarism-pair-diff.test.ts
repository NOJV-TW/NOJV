// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { m } from "$lib/paraglide/messages.js";
import type { PlagiarismPairDiffData } from "$lib/types/plagiarism-pair";
import Harness from "./fixtures/plagiarism-pair-diff-harness.svelte";

const monaco = vi.hoisted(() => {
  const original = { dispose: vi.fn(), setValue: vi.fn() };
  const modified = { dispose: vi.fn(), setValue: vi.fn() };
  const diffEditor = { dispose: vi.fn(), getModel: vi.fn(), setModel: vi.fn() };
  return {
    diffEditor,
    modified,
    module: {
      editor: {
        createDiffEditor: vi.fn(() => diffEditor),
        createModel: vi.fn().mockReturnValueOnce(original).mockReturnValueOnce(modified),
        defineTheme: vi.fn(),
        setTheme: vi.fn(),
      },
    },
    original,
  };
});

vi.mock("$lib/utils/monaco-loader", () => ({
  loadMonaco: () => monaco.module,
}));

vi.mock("$lib/components/primitives/ui/button", async () => ({
  Button: (await import("./fixtures/component-button.svelte")).default,
}));

function pairData(pairKey: string, source: string): PlagiarismPairDiffData {
  return {
    pairKey,
    contextType: "assessment",
    contextId: "course-1",
    pair: { similarity: 91, longest: 12, overlap: 8, problemId: "problem-1" },
    left: {
      userId: `${pairKey}-left`,
      displayName: null,
      username: `${pairKey}-left-user`,
      files: [{ path: "main.ts", content: `${source} left` }],
    },
    right: {
      userId: `${pairKey}-right`,
      displayName: null,
      username: `${pairKey}-right-user`,
      files: [{ path: "main.ts", content: `${source} right` }],
    },
    flag: null,
  };
}

async function settle(): Promise<void> {
  await tick();
  await Promise.resolve();
  await tick();
}

describe("PlagiarismPairDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    monaco.module.editor.createModel
      .mockReset()
      .mockReturnValueOnce(monaco.original)
      .mockReturnValueOnce(monaco.modified);
  });

  it("updates models and resets pair-local flag and error when the pair changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            flag: {
              id: "flag-a",
              flaggedBy: "staff-1",
              flaggedAt: "2026-07-15T00:00:00.000Z",
              note: null,
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "pair A delete failed" }), { status: 500 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const target = document.createElement("div");
    const component = mount(Harness, {
      target,
      props: { initialData: pairData("pair-a", "pair A") },
    });
    try {
      await settle();

      (target.querySelector("button") as HTMLButtonElement).click();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await settle();
      expect(target.querySelector("button")?.textContent).toContain(m.plagiarism_unmark());
      (target.querySelector("button") as HTMLButtonElement).click();
      await vi.waitFor(() => expect(target.textContent).toContain("pair A delete failed"));

      component.setData(pairData("pair-b", "pair B"));
      await settle();

      expect(monaco.original.setValue).toHaveBeenLastCalledWith(
        expect.stringContaining("pair B left"),
      );
      expect(monaco.modified.setValue).toHaveBeenLastCalledWith(
        expect.stringContaining("pair B right"),
      );
      expect(target.textContent).not.toContain("pair A delete failed");
      expect(target.querySelector("button")?.textContent).toContain(
        m.plagiarism_markFalsePositive(),
      );
    } finally {
      await unmount(component);
    }
  });
});
