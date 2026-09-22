// @vitest-environment jsdom
import { mount, tick, unmount } from "svelte";
import { expect, it } from "vitest";
import ActivityWeights from "$lib/components/features/course/ActivityWeights.svelte";
import ProblemPicker from "$lib/components/features/course/exam/ProblemPicker.svelte";

it("exposes missing problems and allocation errors to the form scroll selector", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const picker = mount(ProblemPicker, {
    target,
    props: {
      candidateProblems: { personalProblems: [], publicProblems: [] },
      problemIds: [],
      error: "Add a problem",
    },
  });
  await tick();
  try {
    const button = target.querySelector('button[aria-invalid="true"]');
    expect(button).not.toBeNull();
    expect(
      document.getElementById(button!.getAttribute("aria-describedby")!)?.textContent,
    ).toBe("Add a problem");
  } finally {
    await unmount(picker);
  }
  const weights = mount(ActivityWeights, {
    target,
    props: {
      totalPoints: 0,
      problems: [{ problemId: "p1", points: 0 }],
      onchange: () => {},
      totalErrors: ["Allocate points"],
    },
  });
  await tick();
  try {
    const input = target.querySelector('input[aria-invalid="true"]');
    expect(input).not.toBeNull();
    expect(document.getElementById(input!.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Allocate points",
    );
  } finally {
    await unmount(weights);
    target.remove();
  }
});
