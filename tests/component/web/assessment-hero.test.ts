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

async function render(kind: "assignment" | "exam" | "contest", summaryId: string) {
  target = document.createElement("div");
  document.body.append(target);
  component = mount(AssessmentHero, {
    target,
    props: {
      kind,
      typeLabel: "Assignment",
      title: "Process Trace",
      summary: "A long assignment description that needs to be fully readable.",
      summaryId,
    },
  });
  await tick();
}

describe("AssessmentHero expandable summary", () => {
  it.each([
    ["assignment", "assignment-summary-test"],
    ["exam", "exam-summary-test"],
    ["contest", "contest-summary-test"],
  ] as const)("lets any viewer expand an overflowing %s summary", async (kind, summaryId) => {
    stubResizeObserver(true);
    await render(kind, summaryId);

    const summary = target!.querySelector(`#${summaryId}`);
    expect(summary?.classList.contains("line-clamp-2")).toBe(true);

    const moreButton = target!.querySelector("button");
    expect(moreButton).not.toBeNull();
    expect(moreButton?.textContent?.trim()).toMatch(/^(Show more|顯示更多)$/);
    expect(moreButton?.getAttribute("aria-expanded")).toBe("false");
    expect(moreButton?.getAttribute("aria-controls")).toBe(summaryId);

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

  it("does not add a disclosure for a summary that fits", async () => {
    stubResizeObserver(false);
    await render("assignment", "assignment-summary-test");
    expect(target!.querySelector("button")).toBeNull();
  });
});
