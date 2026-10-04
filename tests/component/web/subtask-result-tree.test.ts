// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

import EmptyComponent from "../../fixtures/web/empty-component.svelte";
import { m } from "$lib/paraglide/messages.js";

vi.mock("@lucide/svelte", () => ({ ChevronRight: EmptyComponent }));

describe("SubtaskResultTree", () => {
  it("shows only the score at the top right of the subtask list", async () => {
    const { default: SubtaskResultTree } =
      await import("$lib/components/features/submission/SubtaskResultTree.svelte");
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(SubtaskResultTree, {
      target,
      props: {
        subtaskResults: [
          {
            cases: [],
            label: "sample",
            passed: false,
            rawScore: 0,
            testcaseSetId: "set-1",
            weight: 101,
          },
        ],
      },
    });

    expect(target.textContent).not.toContain(m.subtask_breakdownLabel());
    expect(target.textContent).toContain("#subtask1");
    expect(target.textContent).not.toContain("sample");
    const score = target.querySelector('[data-testid="subtask-score"]');
    expect(score?.textContent).toContain("0/101");
    expect(score?.parentElement?.classList.contains("justify-end")).toBe(true);

    await unmount(component);
    target.remove();
  });

  it("marks a 0-point subtask by its verdict instead of its score", async () => {
    const { default: SubtaskResultTree } =
      await import("$lib/components/features/submission/SubtaskResultTree.svelte");
    const target = document.createElement("div");
    document.body.append(target);
    const subtask = (testcaseSetId: string, passed: boolean) => ({
      cases: [],
      label: testcaseSetId,
      passed,
      rawScore: 0,
      testcaseSetId,
      weight: 0,
    });
    const component = mount(SubtaskResultTree, {
      target,
      props: { subtaskResults: [subtask("failed", false), subtask("passed", true)] },
    });

    const panels = [...target.querySelectorAll("div.rounded-md.border")];
    expect(panels[0]?.classList.contains("border-destructive/30")).toBe(true);
    expect(panels[1]?.classList.contains("border-success/30")).toBe(true);

    await unmount(component);
    target.remove();
  });
});
