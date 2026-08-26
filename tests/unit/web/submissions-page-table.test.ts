// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 15_000 });

const mocks = vi.hoisted(() => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("./fixtures/empty-component.svelte")).default;
  return { Code2: Empty, History: Empty, Loader2: Empty };
});

vi.mock("$lib/stores/sse", () => ({ watchSubmissionVerdict: () => () => undefined }));
vi.mock("$lib/components/primitives/ui/EmptyState.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/primitives/ui/button", async () => ({
  Button: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/primitives/ui/select", async () => ({
  Root: (await import("./fixtures/select-root.svelte")).default,
  Trigger: (await import("./fixtures/select-trigger.svelte")).default,
  Content: (await import("./fixtures/select-content.svelte")).default,
  Item: (await import("./fixtures/select-item.svelte")).default,
}));
vi.mock("$app/navigation", () => ({
  goto: mocks.goto,
  invalidateAll: mocks.invalidateAll,
}));

describe("submissions page", () => {
  it("uses problem, context, language, and verdict filters without performance columns", async () => {
    const { default: SubmissionsPage } =
      await import("../../../apps/web/src/routes/(app)/submissions/+page.svelte");
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(SubmissionsPage, {
      target,
      props: {
        data: {
          nextCursor: null,
          submissions: [
            {
              id: "sub_1",
              createdAt: "2026-08-20T08:00:00.000Z",
              language: "cpp",
              problemId: "p1",
              problemTitle: "A + B",
              runtimeMs: 12,
              memoryKb: 1024,
              score: 100,
              totalScore: 100,
              status: "accepted",
              context: "assignment",
            },
          ],
        },
      },
    });

    expect(target.querySelector("table")).not.toBeNull();
    for (const label of ["Problem", "Context", "Language", "Verdict"]) {
      expect(target.querySelector(`[aria-label="${label}"]`)?.closest("th")).not.toBeNull();
    }
    const filterTriggers = [...target.querySelectorAll("thead [aria-label]")];
    expect(filterTriggers).toHaveLength(4);
    for (const trigger of filterTriggers) {
      expect(trigger.className).toContain("dark:bg-transparent");
      expect(trigger.className).toContain("dark:hover:bg-transparent");
      expect(trigger.className).toContain("!shadow-none");
      expect(trigger.className.split(/\s+/)).not.toContain("border-b");
    }
    expect(target.querySelector("thead .text-success")).not.toBeNull();
    const headerLabels = [...target.querySelectorAll("thead th")].map((header) =>
      header.textContent?.trim(),
    );
    expect(headerLabels).not.toContain("Runtime");
    expect(headerLabels).not.toContain("Memory");

    const row = target.querySelector<HTMLTableRowElement>("tbody tr");
    expect(row?.getAttribute("role")).toBe("link");
    row
      ?.querySelector("td:last-child")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(mocks.goto).toHaveBeenCalledWith("/submissions/sub_1");

    await unmount(component);
    target.remove();
  });
});
