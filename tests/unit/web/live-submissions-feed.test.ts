// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock("$app/navigation", () => ({ goto: mocks.goto }));

import LiveSubmissionsFeed from "$lib/components/features/coursework/LiveSubmissionsFeed.svelte";

const rows = [
  {
    id: "sub_1",
    createdAt: "2026-08-20T08:00:00.000Z",
    ipAddress: "203.0.113.10",
    language: "cpp" as const,
    score: 100,
    status: "accepted",
    problem: { id: "p1", title: "A + B" },
    user: { id: "u1", name: "Alice", username: "student01" },
  },
  {
    id: "sub_2",
    createdAt: "2026-08-20T08:01:00.000Z",
    ipAddress: "203.0.113.22",
    language: "cpp" as const,
    score: 100,
    status: "accepted",
    problem: { id: "p1", title: "A + B" },
    user: { id: "u2", name: "Bob", username: "student02" },
  },
];

describe("LiveSubmissionsFeed", () => {
  afterEach(() => {
    mocks.goto.mockReset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens a submission from anywhere on the row with mouse or keyboard", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(LiveSubmissionsFeed, {
      target,
      props: { rows, refreshUrl: "/api/submissions?context=assignment&id=a1" },
    });
    const row = target.querySelector<HTMLTableRowElement>("tbody tr");

    expect(row?.getAttribute("role")).toBe("link");
    row
      ?.querySelector("td:nth-child(2)")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(mocks.goto).toHaveBeenLastCalledWith("/submissions/sub_1");

    row?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(mocks.goto).toHaveBeenCalledTimes(2);

    await unmount(component);
    target.remove();
  });

  it("combines verdict, language, problem, student number, and IP filters", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(LiveSubmissionsFeed, {
      target,
      props: { rows, search: "203.0.113.10" },
    });
    for (const label of ["Verdict", "Language", "Problem"]) {
      expect(target.querySelector(`[aria-label="${label}"]`)?.closest("th")).not.toBeNull();
    }

    const setValue = async (selector: string, value: string) => {
      const control = target.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
      expect(control).not.toBeNull();
      control!.value = value;
      control!.dispatchEvent(
        new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
      );
      await tick();
    };

    await setValue('[aria-label="Verdict"]', "accepted");
    await setValue('[aria-label="Language"]', "cpp");
    await setValue('[aria-label="Problem"]', "p1");
    expect(target.textContent).toContain("student01");
    expect(target.textContent).not.toContain("student02");

    await unmount(component);
    target.remove();
  });

  it("refreshes only the feed while the page is visible", async () => {
    vi.useFakeTimers();
    const refreshedRows = [
      { ...rows[0]!, id: "sub_3", user: { ...rows[0]!.user, name: "Carol" } },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: refreshedRows }),
    });
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(LiveSubmissionsFeed, {
      target,
      props: { rows, refreshUrl: "/api/submissions?context=assignment&id=a1" },
    });

    await vi.advanceTimersByTimeAsync(5000);
    await tick();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(target.textContent).toContain("Carol");
    expect(target.textContent).not.toContain("Bob");

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledOnce();

    await unmount(component);
    target.remove();
  });
});
