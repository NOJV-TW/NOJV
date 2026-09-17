// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

import EmptyComponent from "./fixtures/empty-component.svelte";

vi.mock("@lucide/svelte", () => ({
  ChevronDown: EmptyComponent,
  ChevronRight: EmptyComponent,
  Pencil: EmptyComponent,
  Trash2: EmptyComponent,
}));
vi.mock("$lib/components/features/problem/testcase/TestcaseRow.svelte", () => ({
  default: EmptyComponent,
}));
vi.mock("$lib/components/features/problem/testcase/TestcaseSetEditForm.svelte", () => ({
  default: EmptyComponent,
}));

describe("TestcaseSetCard", () => {
  it("renders math in the set name instead of raw LaTeX source", async () => {
    const { default: TestcaseSetCard } =
      await import("$lib/components/features/problem/testcase/TestcaseSetCard.svelte");
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(TestcaseSetCard, {
      target,
      props: {
        problemId: "problem-1",
        set: {
          id: "set-1",
          name: "Subtask 01: $R, C \\le 2$",
          description: "",
          weight: 20,
          testcases: [],
        },
      },
    });

    const header = target.querySelector("button");
    expect(header?.querySelector(".katex-html")).not.toBeNull();
    expect(header?.textContent).toContain("Subtask 01:");
    expect(header?.querySelector("p")).toBeNull();

    await unmount(component);
    target.remove();
  });
});
