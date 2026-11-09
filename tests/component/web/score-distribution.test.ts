import { mount, tick, unmount } from "svelte";
import { expect, it } from "vitest";
import ScoreDistributionPanel from "#lib/components/features/results/ScoreDistributionPanel.svelte";

it("uses the displayed population for proportions, including zero scores", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(ScoreDistributionPanel, {
    target,
    props: {
      buckets: [
        { label: "450–500", count: 2 },
        { label: "0–<50", count: 6 },
      ],
    },
  });
  await tick();
  expect(target.textContent).toContain("25.0%");
  expect(target.textContent).toContain("75.0%");
  expect(
    [...target.querySelectorAll<HTMLElement>(".h-full")].map((bar) => bar.style.width),
  ).toEqual(["25%", "75%"]);
  await unmount(component);
  target.remove();
});

it("renders empty intervals without invalid percentages", async () => {
  const target = document.createElement("div");
  const component = mount(ScoreDistributionPanel, {
    target,
    props: { buckets: [{ label: "0–<50", count: 0 }] },
  });
  await tick();
  expect(target.textContent).toContain("0.0%");
  expect(target.textContent).not.toMatch(/NaN|Infinity/);
  await unmount(component);
});
