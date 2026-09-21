// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProblemSelectDialog from "$lib/components/features/problem/ProblemSelectDialog.svelte";

const candidateProblems = {
  personalProblems: [
    {
      id: "problem-1",
      displayId: 1,
      title: "Add Two Numbers",
      difficulty: "easy" as const,
      judgeType: "standard" as const,
      status: "published" as const,
      tags: [],
      type: "full_source" as const,
      visibility: "private" as const,
    },
  ],
  publicProblems: [],
};

describe("ProblemSelectDialog", () => {
  let target: HTMLDivElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => vi.useFakeTimers());

  afterEach(async () => {
    try {
      if (component) await unmount(component);
      await vi.runOnlyPendingTimersAsync();
    } finally {
      vi.useRealTimers();
      target?.remove();
      document.body.innerHTML = "";
    }
  });

  it("selects a problem when the whole problem row is clicked", async () => {
    target = document.createElement("div");
    document.body.append(target);
    component = mount(ProblemSelectDialog, {
      target,
      props: {
        candidateProblems,
        selectedIds: [],
        open: true,
        onConfirm: () => {},
      },
    });
    await tick();

    const row = target.ownerDocument.querySelector(
      'button[role="checkbox"]',
    ) as HTMLButtonElement;
    expect(row).toBeTruthy();
    expect(row.textContent).toContain("Add Two Numbers");
    row.click();
    await tick();

    expect(document.body.textContent).toContain("1 selected");
  });
});
