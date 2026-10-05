// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

import EmptyComponent from "../../fixtures/web/empty-component.svelte";
import ProblemDescriptionPanel from "$lib/components/features/problem/left-panel/ProblemDescriptionPanel.svelte";
import { m } from "$lib/paraglide/messages.js";

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
  it("labels subtasks by number and renders the description as markdown with math", async () => {
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

    expect(target.textContent).toContain("#subtask1");
    expect(target.textContent).toContain("#subtask2");
    expect(target.textContent).not.toContain("Subtask 01:");
    expect(target.textContent).toContain("Trivial grid with");
    expect(target.querySelectorAll(".katex-html")).toHaveLength(1);
    expect(target.textContent).toContain("20%");

    await unmount(component);
    target.remove();
  });

  it("renders a sample explanation as markdown only when the sample has one", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(ProblemDescriptionPanel, {
      target,
      props: {
        problem: {
          displayId: 1,
          title: "Sum",
          difficulty: "easy",
          tags: [],
          type: "full_source",
          judgeType: "standard",
          timeLimitMs: 1000,
          memoryLimitMb: 256,
          statement: "",
          inputFormat: "",
          outputFormat: "",
          samples: [
            { input: "1 2", output: "3", explanation: "Add them: $1 + 2 = 3$" },
            { input: "0 0", output: "0" },
          ],
        } as never,
        testcaseSets: [],
      },
    });

    expect(target.textContent).toContain("Add them:");
    expect(target.querySelectorAll(".katex-html")).toHaveLength(1);
    expect(target.textContent.match(/Explanation/g)).toHaveLength(1);

    await unmount(component);
    target.remove();
  });

  function mountWithInteraction(judgeType: "interactive" | "standard") {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(ProblemDescriptionPanel, {
      target,
      props: {
        problem: {
          displayId: 2,
          title: "Guess",
          difficulty: "easy",
          tags: [],
          type: "full_source",
          judgeType,
          timeLimitMs: 1000,
          memoryLimitMb: 256,
          statement: "",
          inputFormat: "",
          outputFormat: "",
          interactionFormat: "The interactor reads the hidden number $x$.",
          samples: [
            { input: "1 1000000", output: "? 500000", interactorInput: "424242" },
            { input: "1 1000000", output: "? 1" },
          ],
        } as never,
        testcaseSets: [],
      },
    });
    return { target, component };
  }

  it("shows interaction notes and each sample's interactor input on an interactive problem", async () => {
    const { target, component } = mountWithInteraction("interactive");

    expect(target.textContent).toContain(`${m.problem_interactionFormat()}:`);
    expect(target.textContent).toContain("The interactor reads the hidden number");
    expect(target.querySelectorAll(".katex-html")).toHaveLength(1);
    expect(target.textContent.split(m.problem_interactionSampleInput())).toHaveLength(2);
    expect(target.textContent).toContain("424242");

    await unmount(component);
    target.remove();
  });

  it("shows no interaction content on a standard problem", async () => {
    const { target, component } = mountWithInteraction("standard");

    expect(target.textContent).not.toContain(m.problem_interactionFormat());
    expect(target.textContent).not.toContain("The interactor reads the hidden number");
    expect(target.textContent).not.toContain(m.problem_interactionSampleInput());
    expect(target.textContent).not.toContain("424242");

    await unmount(component);
    target.remove();
  });
});
