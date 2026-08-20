// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

import EmptyComponent from "./fixtures/empty-component.svelte";

vi.mock("@lucide/svelte", () => ({ ArrowLeft: EmptyComponent }));
vi.mock("$lib/components/features/problem/left-panel/ProblemDescriptionPanel.svelte", () => ({
  default: EmptyComponent,
}));
vi.mock("$lib/components/features/problem/left-panel/SubmissionHistoryPanel.svelte", () => ({
  default: EmptyComponent,
}));
vi.mock("$lib/components/features/problem/left-panel/PostPanel.svelte", () => ({
  default: EmptyComponent,
}));

describe("ProblemLeftPanel", () => {
  it("does not render a submission count beside the submissions tab", async () => {
    const { default: ProblemLeftPanel } =
      await import("$lib/components/features/problem/layouts/ProblemLeftPanel.svelte");
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(ProblemLeftPanel, {
      target,
      props: {
        problem: {} as never,
        submissions: [
          {
            id: "submission-1",
            language: "cpp",
            submittedAt: "2026-08-20T08:00:00.000Z",
          },
        ],
      },
    });

    const submissionsTab = target.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
    expect(submissionsTab).not.toBeUndefined();
    expect(submissionsTab?.querySelector("span")).toBeNull();

    await unmount(component);
    target.remove();
  });
});
