// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

import EmptyComponent from "./fixtures/empty-component.svelte";

vi.mock("@lucide/svelte", () => ({ MemoryStick: EmptyComponent, Timer: EmptyComponent }));
vi.mock("$lib/components/features/problem/left-panel/SpecialLabels.svelte", () => ({
  default: EmptyComponent,
}));
vi.mock("$lib/components/features/problem/listings/BookmarkButton.svelte", () => ({
  default: EmptyComponent,
}));
vi.mock("$lib/components/primitives/ui/CopyButton.svelte", () => ({
  default: EmptyComponent,
}));

describe("ProblemDescriptionPanel", () => {
  it("renders each subtask's name and description as markdown with math", async () => {
    const { default: ProblemDescriptionPanel } =
      await import("$lib/components/features/problem/left-panel/ProblemDescriptionPanel.svelte");
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(ProblemDescriptionPanel, {
      target,
      props: {
        problem: {
          displayId: 78,
          title: "Mowing",
          difficulty: "easy",
          tags: [],
          type: "full_source",
          judgeType: "standard",
          timeLimitMs: 1000,
          memoryLimitMb: 256,
          statement: "",
          inputFormat: "",
          outputFormat: "",
          samples: [],
        } as never,
        testcaseSets: [
          {
            id: "set-1",
            name: "Subtask 01: $R \\le 2$",
            description: "Trivial grid with $\\min(R, C) = 1$",
            weight: 20,
            ordinal: 0,
            caseCount: 3,
          },
          {
            id: "set-2",
            name: "Subtask 02",
            description: "",
            weight: 80,
            ordinal: 1,
            caseCount: 3,
          },
        ],
      },
    });

    expect(target.textContent).not.toContain("#subtask");
    expect(target.textContent).toContain("Subtask 01:");
    expect(target.textContent).toContain("Trivial grid with");
    expect(target.querySelectorAll(".katex").length).toBe(2);
    expect(target.textContent).toContain("20%");

    await unmount(component);
    target.remove();
  });
});
