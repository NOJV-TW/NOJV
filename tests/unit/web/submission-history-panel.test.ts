// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import { m } from "$lib/paraglide/messages.js";

vi.mock("@lucide/svelte", async () => ({
  Copy: (await import("./fixtures/empty-component.svelte")).default,
  Check: (await import("./fixtures/empty-component.svelte")).default,
  RotateCcw: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("@lucide/svelte/icons/rotate-ccw", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/primitives/ui/CodeBlock.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/submission/SubtaskResultTree.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/submission/CaseResultGrid.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/services/http", () => ({ fetchWithCsrf: vi.fn() }));
vi.mock("$lib/stores/toast", () => ({ toasts: { error: vi.fn(), success: vi.fn() } }));

describe("SubmissionHistoryPanel", () => {
  let component: ReturnType<typeof mount> | undefined;
  let target: HTMLDivElement | undefined;

  afterEach(async () => {
    if (component) await unmount(component);
    target?.remove();
  });

  it("moves the score into the summary row and displays memory", async () => {
    const { default: SubmissionHistoryPanel } =
      await import("$lib/components/features/problem/left-panel/SubmissionHistoryPanel.svelte");
    target = document.createElement("div");
    document.body.append(target);
    component = mount(SubmissionHistoryPanel, {
      target,
      props: {
        submissions: [
          {
            id: "submission-1",
            language: "cpp",
            submittedAt: "2026-08-20T08:00:00.000Z",
            sourceCode: "int main() {}",
            result: {
              accepted: false,
              caseResults: [],
              feedback: "Wrong answer",
              memoryKb: 26_316,
              runtimeMs: 170,
              score: 0,
              subtaskResults: [],
              verdict: "wrong_answer",
            },
          },
        ],
        total: 101,
        viewingId: "submission-1",
      },
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const copy = target.querySelector<HTMLButtonElement>('[aria-label="Copy submission ID"]')!;
    copy.click();
    await vi.waitFor(() => expect(copy.getAttribute("aria-label")).toBe("Copied"));
    expect(writeText).toHaveBeenCalledWith("submission-1");

    expect(target.textContent).not.toContain(m.submissionDetail_finalScoreLabel());
    expect(target.textContent).toContain(`${m.submissionDetail_runtime()}: 170 ms`);
    expect(target.textContent).toContain(`${m.submissionDetail_memory()}: 25.7 MB`);
    expect(target.querySelector('[data-testid="submission-score"]')?.textContent).toContain(
      "0/101",
    );

    target.querySelector<HTMLButtonElement>("button")!.click();
    await tick();
    expect(target.querySelector("[data-submission-id]")).toBeNull();
    expect(target.querySelector('[aria-label="Copy submission ID"]')).toBeNull();
    target.querySelector<HTMLButtonElement>("button")!.click();
    await tick();
    expect(
      target.querySelector("[data-submission-id]")?.getAttribute("data-submission-id"),
    ).toBe("submission-1");
    expect(target.querySelector('[aria-label="Copy submission ID"]')).not.toBeNull();
  });
});
