// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";

vi.mock("$lib/components/primitives/ui/select/select-content.svelte", async () => ({
  default: (await import("./fixtures/select-content.svelte")).default,
}));

vi.mock("@lucide/svelte", async () => ({
  ListFilter: (await import("./fixtures/empty-component.svelte")).default,
  Loader2: (await import("./fixtures/empty-component.svelte")).default,
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
    const query = new URL(url, "http://localhost").searchParams;
    const userSearch = query.get("userSearch") ?? "";
    const ipSearch = query.get("ipSearch") ?? "";
    return page(
      rows.filter(
        (row) => row.user.username.includes(userSearch) && row.ipAddress.includes(ipSearch),
      ),
    );
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

    const setTextFilter = async (
      label: string,
      inputId: string,
      value: string,
      enter = false,
    ) => {
      const trigger = target.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
      expect(trigger.closest("th")).not.toBeNull();
      expect(document.querySelector(`#${inputId}`)).toBeNull();
      trigger.click();
      const input = await vi.waitFor(() => {
        const field = document.querySelector<HTMLInputElement>(`#${inputId}`);
        expect(field).not.toBeNull();
        return field!;
      });
      const before = mocks.read.mock.lastCall?.[0];
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await tick();
      expect(mocks.read.mock.lastCall?.[0]).toBe(before);
      if (enter)
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      else
        [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
          .find((button) => button.textContent?.trim() === m.common_applyFilter())!
          .click();
      await vi.waitFor(() => expect(document.querySelector(`#${inputId}`)).toBeNull());
    };
    await setTextFilter(
      m.submissions_filterUser(),
      "live-submissions-user-search",
      " student01 ",
    );
    await setTextFilter(
      m.submissions_filterIp(),
      "live-submissions-ip-search",
      "203.0.113.10",
      true,
    );
    await vi.waitFor(() => expect(target.textContent).not.toContain("student02"));
    expect(target.textContent).toContain("student01");
    const query = new URL(mocks.read.mock.lastCall?.[0], "http://localhost").searchParams;
    expect(Object.fromEntries(query)).toMatchObject({
      context: "assignment",
      id: "a1",
      status: "accepted",
      language: "cpp",
      filterProblemId: "p1",
      userSearch: "student01",
      ipSearch: "203.0.113.10",
    });
    expect(query.has("search")).toBe(false);

    await setTextFilter(m.submissions_filterIp(), "live-submissions-ip-search", "192.0.2.1");
    await vi.waitFor(() => expect(target.textContent).toContain(m.submissions_noMatches()));
    await setTextFilter(m.submissions_filterIp(), "live-submissions-ip-search", "");
    await vi.waitFor(() => expect(target.textContent).toContain("Alice"));
    expect(target.textContent).not.toContain("Bob");
    const cleared = new URL(mocks.read.mock.lastCall?.[0], "http://localhost").searchParams;
    expect(cleared.get("userSearch")).toBe("student01");
    expect(cleared.has("ipSearch")).toBe(false);

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
});
