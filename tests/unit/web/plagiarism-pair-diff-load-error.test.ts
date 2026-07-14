// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { expect, it, vi } from "vitest";

import { m } from "$lib/paraglide/messages.js";
import type { PlagiarismPairDiffData } from "$lib/types/plagiarism-pair";
import Harness from "./fixtures/plagiarism-pair-diff-harness.svelte";

vi.mock("$lib/utils/monaco-loader", () => ({
  loadMonaco: () => {
    throw new Error("chunk unavailable");
  },
}));

vi.mock("$lib/components/primitives/ui/button", async () => ({
  Button: (await import("./fixtures/component-button.svelte")).default,
}));

const data: PlagiarismPairDiffData = {
  pairKey: "pair-a",
  contextType: "assessment",
  contextId: "assessment-1",
  pair: { similarity: 91, longest: 12, overlap: 8, problemId: "problem-1" },
  left: {
    userId: "left",
    displayName: null,
    username: "left-user",
    files: [{ path: "main.ts", content: "left" }],
  },
  right: {
    userId: "right",
    displayName: null,
    username: "right-user",
    files: [{ path: "main.ts", content: "right" }],
  },
  flag: null,
};

it("renders the existing editor-load failure copy as an alert", async () => {
  const target = document.createElement("div");
  const component = mount(Harness, { target, props: { initialData: data } });

  try {
    await vi.waitFor(() => {
      const alert = target.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain(m.editor_loadFailed());
    });
  } finally {
    await unmount(component);
  }
});
