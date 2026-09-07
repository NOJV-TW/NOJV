// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 15_000 });

const mocks = vi.hoisted(() => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

vi.mock("$lib/components/primitives/ui/select/select-content.svelte", async () => ({
  default: (await import("./fixtures/select-content.svelte")).default,
}));

vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("./fixtures/empty-component.svelte")).default;
  return { Code2: Empty, History: Empty, ListFilter: Empty, Loader2: Empty };
});

vi.mock("$lib/stores/sse", () => ({ watchSubmissionVerdict: () => () => undefined }));
vi.mock("$lib/components/primitives/ui/EmptyState.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/primitives/ui/button", async () => ({
  Button: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$app/navigation", () => ({
  goto: mocks.goto,
  invalidateAll: mocks.invalidateAll,
}));

describe("submissions page", () => {
  it.each([false, true])(
    "shows submitter only with admin mode %s",
    async (adminAccessActive) => {
      const { default: SubmissionsPage } =
        await import("../../../apps/web/src/routes/(app)/submissions/+page.svelte");
      const target = document.createElement("div");
      document.body.append(target);
      const component = mount(SubmissionsPage, {
        target,
        props: {
          data: {
            adminAccessActive,
            nextCursor: null,
            submissions: [
              {
                id: "sub_1",
                user: { name: "Alice", username: "alice" },
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
      const filterTriggers = [
        ...target.querySelectorAll<HTMLButtonElement>('thead button[aria-haspopup="listbox"]'),
      ];
      expect(filterTriggers).toHaveLength(4);
      for (const trigger of filterTriggers) {
        expect(trigger.tagName).toBe("BUTTON");
        expect(trigger.className).toContain("items-center");
      }
      expect(target.querySelectorAll("thead tr")).toHaveLength(1);
      const headerLabels = [...target.querySelectorAll("thead th")].map((header) =>
        header.textContent?.trim(),
      );
      expect(headerLabels.includes("User")).toBe(adminAccessActive);
      expect(target.textContent?.includes("@alice")).toBe(adminAccessActive);
      expect(target.querySelectorAll("tbody td")).toHaveLength(adminAccessActive ? 7 : 6);
      expect(headerLabels).not.toContain("Runtime");
      expect(headerLabels).not.toContain("Memory");

      const row = target.querySelector<HTMLTableRowElement>("tbody tr");
      expect(row?.getAttribute("role")).toBe("link");
      expect(row?.querySelector("[data-submission-id]")).toBeNull();
      expect(row?.querySelector('[aria-label="Copy submission ID"]')).toBeNull();
      row
        ?.querySelector("td:last-child")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(mocks.goto).toHaveBeenCalledWith("/submissions/sub_1");

      const verdictFilter = target.querySelector<HTMLButtonElement>('[aria-label="Verdict"]')!;
      verdictFilter.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      await tick();
      const option = await vi.waitFor(() => {
        const item = document.querySelector<HTMLElement>(
          '[role="option"][data-value="wrong_answer"]',
        );
        expect(item).not.toBeNull();
        return item!;
      });
      option.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      await tick();
      expect(verdictFilter.textContent?.trim()).toBe("WA");
      expect(target.textContent).toContain("No submissions match these filters.");
      expect(target.querySelector("tbody td")?.getAttribute("colspan")).toBe(
        adminAccessActive ? "7" : "6",
      );

      await unmount(component);
      target.remove();
    },
  );
});
