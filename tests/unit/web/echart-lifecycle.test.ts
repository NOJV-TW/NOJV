// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import axe from "axe-core";
import * as echarts from "echarts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chart = vi.hoisted(() => ({
  dispose: vi.fn(),
  resize: vi.fn(),
  setOption: vi.fn(),
}));
const init = vi.hoisted(() => vi.fn(() => chart));

import Harness from "./fixtures/echart-harness.svelte";

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  disconnect = vi.fn();
  observe = vi.fn();

  constructor(_callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }
}

describe("EChart lifecycle", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    ResizeObserverMock.instances = [];
    vi.clearAllMocks();
    vi.spyOn(echarts, "init").mockImplementation(init as typeof echarts.init);
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("preserves formatter functions, exposes a data summary, and releases resources", async () => {
    const formatter = () => "formatted";
    const option = { tooltip: { formatter } };
    const target = document.createElement("main");
    document.body.append(target);
    const component = mount(Harness, {
      target,
      props: {
        initialOption: option,
        ariaLabel: "Verdict distribution",
        summary: "Accepted: 12; Wrong answer: 3",
        class: "h-64",
      },
    });

    await vi.waitFor(() => expect(init).toHaveBeenCalledOnce());
    await tick();

    expect(chart.setOption).toHaveBeenCalledWith(option, {
      lazyUpdate: true,
      notMerge: true,
    });
    expect(chart.setOption.mock.calls[0]?.[0].tooltip.formatter).toBe(formatter);
    const nextFormatter = () => "updated";
    const nextOption = { tooltip: { formatter: nextFormatter } };
    component.setOption(nextOption);
    await tick();
    expect(chart.setOption).toHaveBeenLastCalledWith(nextOption, {
      lazyUpdate: true,
      notMerge: true,
    });
    expect(chart.setOption.mock.calls.at(-1)?.[0].tooltip.formatter).toBe(nextFormatter);
    const image = document.querySelector('[role="img"]');
    expect(image?.getAttribute("aria-labelledby")).toContain("-label");
    expect(document.body.textContent).toContain("Verdict distribution");
    expect(document.body.textContent).toContain("Accepted: 12; Wrong answer: 3");
    const accessibility = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(accessibility.violations).toEqual([]);

    await unmount(component);
    target.remove();
    expect(chart.dispose).toHaveBeenCalledOnce();
    expect(ResizeObserverMock.instances[0]?.disconnect).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
  });

  it("does not create resources when the component unmounts before the import resolves", async () => {
    const target = document.createElement("main");
    document.body.append(target);
    const component = mount(Harness, {
      target,
      props: {
        initialOption: {},
        ariaLabel: "Empty chart",
        summary: "No data",
      },
    });

    await unmount(component);
    await Promise.resolve();
    await tick();

    expect(init).not.toHaveBeenCalled();
    expect(ResizeObserverMock.instances).toEqual([]);
    target.remove();
  });
});
