// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import AssessmentHero from "$lib/components/features/coursework/AssessmentHero.svelte";

let component: ReturnType<typeof mount> | undefined;
let target: HTMLDivElement | undefined;

afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  target?.remove();
  target = undefined;
  vi.unstubAllGlobals();
});

function stubResizeObserver(isOverflowing: boolean) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(element: Element) {
        Object.defineProperties(element, {
          clientHeight: { configurable: true, value: 40 },
          scrollHeight: { configurable: true, value: isOverflowing ? 120 : 40 },
        });
        this.callback([], this as unknown as ResizeObserver);
      }

      disconnect() {}
    },
  );
}

async function render(expandableSummary = true) {
  target = document.createElement("div");
  document.body.append(target);
  component = mount(AssessmentHero, {
    target,
    props: {
      kind: "assignment",
      typeLabel: "Assignment",
      title: "Process Trace",
      summary: "A long assignment description that needs to be fully readable.",
      summaryId: "assignment-summary-test",
      expandableSummary,
    },
  });
  await tick();
}

describe("AssessmentHero expandable summary", () => {
  it("shows a disclosure only when the student summary is clipped and can restore the clamp", async () => {
    stubResizeObserver(true);
    await render();

    const summary = target!.querySelector("p");
    expect(summary?.classList.contains("line-clamp-2")).toBe(true);

    const moreButton = target!.querySelector("button");
    expect(moreButton).not.toBeNull();
    expect(moreButton?.textContent?.trim()).toMatch(/^(Show more|顯示更多)$/);
    expect(moreButton?.getAttribute("aria-expanded")).toBe("false");
    expect(moreButton?.getAttribute("aria-controls")).toBe("assignment-summary-test");

    moreButton?.click();
    await tick();

    const lessButton = target!.querySelector("button");
    expect(summary?.classList.contains("line-clamp-2")).toBe(false);
    expect(lessButton?.textContent?.trim()).toMatch(/^(Show less|收合)$/);
    expect(lessButton?.getAttribute("aria-expanded")).toBe("true");

    lessButton?.click();
    await tick();
    expect(summary?.classList.contains("line-clamp-2")).toBe(true);
  });

  it("does not add a disclosure for a summary that fits or for a non-student view", async () => {
    stubResizeObserver(false);
    await render();
    expect(target!.querySelector("button")).toBeNull();

    if (component) await unmount(component);
    component = undefined;
    target?.remove();
    target = undefined;

    stubResizeObserver(true);
    await render(false);
    expect(target!.querySelector("button")).toBeNull();
    expect(target!.querySelector("p")?.classList.contains("line-clamp-2")).toBe(true);
  });
});
