// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/components/primitives/ui/select/select-content.svelte", async () => ({
  default: (await import("./fixtures/select-content.svelte")).default,
}));

vi.mock("@lucide/svelte", async () => ({
  ListFilter: (await import("./fixtures/empty-component.svelte")).default,
}));

const mocks = vi.hoisted(() => ({
  goto: vi.fn(),
  read: vi.fn(),
  watch: vi.fn(() => () => undefined),
  callbacks: new Set<(signal: AbortSignal) => Promise<void>>(),
}));
vi.mock("$lib/services/submission-tracker", () => ({
  watchSubmissionStates: mocks.watch,
  isNewerSubmission: () => true,
  submissionRead: mocks.read,
  onSubmissionRefresh(callback: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    mocks.callbacks.add(callback);
    queueMicrotask(() => {
      if (!controller.signal.aborted) void callback(controller.signal);
    });
    return () => {
      controller.abort();
      mocks.callbacks.delete(callback);
    };
  },
}));
vi.mock("$app/navigation", () => ({ goto: mocks.goto }));

import LiveSubmissionsFeed from "$lib/components/features/coursework/LiveSubmissionsFeed.svelte";
import LiveSubmissionsSearchHarness from "./fixtures/live-submissions-search-harness.svelte";

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

function page(items: typeof rows) {
  return {
    items,
    page: 1,
    pageSize: 50,
    totalCount: items.length,
    totalPages: 1,
    newCount: 0,
    snapshot: "snapshot",
  };
}
beforeEach(() => {
  mocks.watch.mockClear();
  mocks.read.mockImplementation(async (url: string) => {
    const search = new URL(url, "http://localhost").searchParams.get("search");
    return page(search ? rows.filter((row) => row.ipAddress.includes(search)) : rows);
  });
});

describe("LiveSubmissionsFeed", () => {
  afterEach(() => {
    mocks.goto.mockReset();
    mocks.read.mockReset();
    mocks.callbacks.clear();
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
    expect(row?.querySelector("[data-submission-id]")).toBeNull();
    expect(row?.querySelector('[aria-label="Copy submission ID"]')).toBeNull();
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
      props: {
        rows,
        search: "203.0.113.10",
        refreshUrl: "/api/submissions?context=assignment&id=a1",
      },
    });
    for (const label of ["Verdict", "Language", "Problem"]) {
      expect(target.querySelector(`[aria-label="${label}"]`)?.closest("th")).not.toBeNull();
    }

    const setValue = async (selector: string, value: string) => {
      const control = target.querySelector<HTMLButtonElement>(selector);
      expect(control).not.toBeNull();
      control!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await tick();
      const option = await vi.waitFor(() => {
        const item = document.querySelector<HTMLElement>(
          `[role="option"][data-value="${value}"]`,
        );
        expect(item).not.toBeNull();
        return item!;
      });
      option.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      await tick();
    };

    await setValue('[aria-label="Verdict"]', "accepted");
    await setValue('[aria-label="Language"]', "cpp");
    await setValue('[aria-label="Problem"]', "p1");
    await vi.waitFor(() => expect(target.textContent).not.toContain("student02"));
    expect(target.textContent).toContain("student01");
    const query = new URL(mocks.read.mock.lastCall?.[0], "http://localhost").searchParams;
    expect(Object.fromEntries(query)).toMatchObject({
      context: "assignment",
      id: "a1",
      status: "accepted",
      language: "cpp",
      filterProblemId: "p1",
      search: "203.0.113.10",
    });

    await unmount(component);
    target.remove();
  });

  it("keeps new rows behind a latest action during shared background refresh", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(LiveSubmissionsFeed, {
      target,
      props: { rows, refreshUrl: "/api/submissions?context=assignment&id=a1" },
    });
    await tick();
    await vi.waitFor(() => expect(mocks.watch).toHaveBeenCalledTimes(2));
    const refreshedRows = [
      { ...rows[0]!, id: "sub_3", user: { ...rows[0]!.user, name: "Carol" } },
    ];
    mocks.read.mockResolvedValue({ ...page(refreshedRows), newCount: 1 });
    await Promise.all(
      [...mocks.callbacks].map((callback) => callback(new AbortController().signal)),
    );
    await tick();
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(target.textContent).not.toContain("Carol");
    expect(target.textContent).toContain("Bob");
    const latest = target.querySelector<HTMLButtonElement>("button.border-primary");
    expect(latest).not.toBeNull();
    latest!.click();
    await vi.waitFor(() => expect(target.textContent).toContain("Carol"));
    expect(target.textContent).not.toContain("Bob");
    await unmount(component);
    expect(mocks.callbacks.size).toBe(0);
    target.remove();
  });

  it("only queries once for a student number typed one keystroke at a time", async () => {
    vi.useFakeTimers();
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(LiveSubmissionsSearchHarness, {
      target,
      props: { rows, refreshUrl: "/api/submissions?context=assignment&id=a1" },
    });
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    mocks.read.mockClear();

    for (const partial of ["2", "20", "203", "203.0.113.10"]) {
      component.type(partial);
      await tick();
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(mocks.read).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(
      new URL(mocks.read.mock.lastCall?.[0], "http://localhost").searchParams.get("search"),
    ).toBe("203.0.113.10");

    await unmount(component);
    target.remove();
  });
});
