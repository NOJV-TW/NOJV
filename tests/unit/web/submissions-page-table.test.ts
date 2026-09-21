// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";

vi.setConfig({ testTimeout: 15_000 });

afterEach(() => {
  vi.unstubAllGlobals();
});

const mocks = vi.hoisted(() => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

vi.mock("$lib/components/primitives/ui/select/select-content.svelte", async () => ({
  default: (await import("./fixtures/select-content.svelte")).default,
}));

vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("./fixtures/empty-component.svelte")).default;
  return {
    Code2: Empty,
    History: Empty,
    ListFilter: Empty,
    Loader2: Empty,
    ChevronFirst: Empty,
    ChevronLast: Empty,
    ChevronLeft: Empty,
    ChevronRight: Empty,
  };
});

vi.mock("$lib/services/submission-tracker", () => ({
  watchSubmissionStates: () => () => undefined,
  isNewerSubmission: () => true,
  submissionRead: async (url: string) => (await fetch(url)).json(),
  onSubmissionRefresh(callback: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void callback(controller.signal);
    });
    return () => controller.abort();
  },
}));
vi.mock("$lib/stores/sse", () => ({ watchSubmissionVerdict: () => () => undefined }));
vi.mock("$lib/components/primitives/ui/EmptyState.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$app/navigation", () => ({
  goto: mocks.goto,
  invalidateAll: mocks.invalidateAll,
  invalidate: mocks.invalidateAll,
}));

describe("submissions page", () => {
  it.each([false, true])(
    "shows submitter only with admin mode %s",
    async (adminAccessActive) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      const initial = {
        id: "sub_1",
        user: { name: "Alice", username: "alice" },
        createdAt: "2026-08-20T08:00:00.000Z",
        updatedAt: "2026-08-20T08:00:00.000Z",
        judgeGeneration: 1,
        language: "cpp",
        problemId: "p1",
        problemTitle: "A + B",
        runtimeMs: 12,
        memoryKb: 1024,
        score: 100,
        totalScore: 100,
        status: "accepted",
        context: "assignment",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const filtered = new URL(url, "http://localhost").searchParams.get("status");
          return new Response(
            JSON.stringify({
              items: filtered === "wrong_answer" ? [] : [initial],
              page: 1,
              pageSize: 50,
              totalCount: filtered === "wrong_answer" ? 0 : 1,
              totalPages: 1,
              snapshot: "s",
              newCount: 0,
            }),
          );
        }),
      );
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
            submissions: [initial],
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
      expect(
        target.querySelector(`[aria-label="${m.submissions_filterUser()}"]`) !== null,
      ).toBe(adminAccessActive);
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
      await vi.waitFor(() =>
        expect(target.textContent).toContain("No submissions match these filters."),
      );
      expect(target.querySelector("table")).not.toBeNull();
      expect(target.querySelector('[aria-label="Verdict"]')).not.toBeNull();
      expect(target.querySelector("tbody td")?.getAttribute("colspan")).toBe(
        adminAccessActive ? "7" : "6",
      );

      await unmount(component);
      target.remove();
    },
  );

  it("applies the user popover to server history and keeps it available to clear empty results", async () => {
    const row = {
      id: "sub_old_match",
      user: { name: "Alice Example", username: "alice" },
      createdAt: "2026-08-20T08:00:00.000Z",
      updatedAt: "2026-08-20T08:00:00.000Z",
      judgeGeneration: 1,
      language: "python",
      problemId: "p1",
      problemTitle: "A + B",
      runtimeMs: 12,
      memoryKb: 1024,
      score: 100,
      totalScore: 100,
      status: "accepted",
      context: "practice",
    };
    const read = vi.fn(async (url: string) => {
      const query = new URL(url, "http://localhost").searchParams;
      const userSearch = query.get("userSearch");
      const matched = userSearch !== "missing";
      return new Response(
        JSON.stringify({
          items: matched ? [row] : [],
          page: Number(query.get("page") ?? 1),
          pageSize: 50,
          totalCount: matched ? (userSearch ? 1 : 151) : 0,
          totalPages: userSearch ? 1 : 4,
          snapshot: userSearch ?? "unfiltered-snapshot",
          newCount: 0,
        }),
      );
    });
    vi.stubGlobal("fetch", read);
    const { default: SubmissionsPage } =
      await import("../../../apps/web/src/routes/(app)/submissions/+page.svelte");
    const target = document.body.appendChild(document.createElement("div"));
    const component = mount(SubmissionsPage, {
      target,
      props: { data: { adminAccessActive: true, nextCursor: null, submissions: [row] } },
    });
    const lastQuery = () =>
      new URL(read.mock.calls.at(-1)![0], "http://localhost").searchParams;
    try {
      await vi.waitFor(() => expect(read).toHaveBeenCalled());
      target
        .querySelector<HTMLButtonElement>(`[aria-label="${m.submissions_next()}"]`)!
        .click();
      await vi.waitFor(() => expect(lastQuery().get("page")).toBe("2"));
      expect(lastQuery().get("snapshot")).toBe("unfiltered-snapshot");

      const applyUserFilter = async (value: string) => {
        target
          .querySelector<HTMLButtonElement>(`[aria-label="${m.submissions_filterUser()}"]`)!
          .click();
        await tick();
        const input = await vi.waitFor(() => {
          const field = document.querySelector<HTMLInputElement>("#submissions-user-search");
          expect(field).not.toBeNull();
          return field!;
        });
        const before = lastQuery().get("userSearch");
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await tick();
        expect(lastQuery().get("userSearch")).toBe(before);
        [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
          .find((button) => button.textContent?.trim() === m.common_applyFilter())!
          .click();
        await vi.waitFor(() =>
          expect(lastQuery().get("userSearch")).toBe(value.trim() || null),
        );
        expect(lastQuery().get("page")).toBe("1");
        expect(lastQuery().has("snapshot")).toBe(false);
        expect(lastQuery().has("search")).toBe(false);
      };
      await applyUserFilter("  Alice  ");
      expect(target.textContent).toContain("@alice");
      await applyUserFilter("missing");
      await vi.waitFor(() => expect(target.textContent).toContain(m.submissions_noMatches()));
      expect(target.querySelector("table")).not.toBeNull();
      await applyUserFilter("");
      await vi.waitFor(() => expect(target.textContent).toContain("@alice"));
      expect(
        target
          .querySelector(`[aria-label="${m.submissions_filterUser()}"]`)
          ?.getAttribute("aria-pressed"),
      ).toBe("false");
    } finally {
      await unmount(component);
      target.remove();
    }
  });
});
