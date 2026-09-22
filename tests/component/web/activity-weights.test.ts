// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import ActivityWeightsHost from "./fixtures/activity-weights-host.svelte";

describe("ActivityWeights", () => {
  let target: HTMLDivElement;
  let component: Record<string, unknown> | undefined;

  afterEach(async () => {
    if (component) await unmount(component);
    target?.remove();
  });

  it("edits points per problem and keeps the bound total equal to their sum", async () => {
    target = document.createElement("div");
    document.body.append(target);
    const totals: number[] = [];
    component = mount(ActivityWeightsHost, {
      target,
      props: { onTotal: (t: number) => totals.push(t) },
    });
    await tick();
    expect(totals).toEqual([100]);

    const add = component.add as (problemId: string) => void;
    add("p1");
    add("p2");
    await tick();
    const inputs = [...target.querySelectorAll<HTMLInputElement>('input[type="number"]')];
    expect(inputs.map((input) => input.value)).toEqual(["100", "100"]);
    expect(totals.at(-1)).toBe(200);

    inputs[1]!.value = "30.5";
    inputs[1]!.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(totals.at(-1)).toBe(130.5);
    expect(target.querySelector('[role="status"]')?.textContent).toContain("130.5");
    expect(target.textContent).not.toContain("%");
    expect(target.querySelector("button")).toBeNull();
  });
});
