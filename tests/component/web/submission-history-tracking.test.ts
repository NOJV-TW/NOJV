// @vitest-environment jsdom
import { mount, tick, unmount } from "svelte";
import type { SubmissionOperation } from "@nojv/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  read: vi.fn(),
  states: new Set<{ ids: string[]; listener: (operation: SubmissionOperation) => void }>(),
  callbacks: new Set<(signal: AbortSignal) => Promise<void>>(),
}));
vi.mock("$lib/services/submission-tracker", () => ({
  submissionRead: mocked.read,
  isNewerSubmission: (incoming: SubmissionOperation, current: SubmissionOperation) =>
    incoming.judgeGeneration > current.judgeGeneration ||
    (incoming.judgeGeneration === current.judgeGeneration &&
      incoming.updatedAt >= current.updatedAt),
  watchSubmissionStates(ids: string[], listener: (operation: SubmissionOperation) => void) {
    const subscription = { ids, listener };
    mocked.states.add(subscription);
    return () => mocked.states.delete(subscription);
  },
  onSubmissionRefresh(callback: (signal: AbortSignal) => Promise<void>) {
    mocked.callbacks.add(callback);
    return () => mocked.callbacks.delete(callback);
  },
}));
vi.mock("$app/navigation", () => ({ goto: vi.fn() }));
vi.mock("$lib/components/primitives/ui/select/select-content.svelte", async () => ({
  default: (await import("../../unit/web/fixtures/select-content.svelte")).default,
}));
vi.mock("@lucide/svelte", async () => ({
  ListFilter: (await import("../../unit/web/fixtures/empty-component.svelte")).default,
}));

import History from "./fixtures/submission-history-controller.svelte";
import ContextFeed from "./fixtures/live-submissions-context.svelte";

const cleanup: (() => Promise<void>)[] = [];
function mountHistory(query = "context=exam&id=A") {
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(History, {
    target,
    props: { query, initial: [] },
  });
  cleanup.push(async () => {
    await unmount(component);
    target.remove();
  });
  return target;
}
async function refresh() {
  await tick();
  await Promise.all([...mocked.callbacks].map((fn) => fn(new AbortController().signal)));
  await tick();
}
async function click(target: HTMLElement, label: string) {
  const button = [...target.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === label,
  );
  expect(button).toBeDefined();
  button!.click();
  await tick();
}
function numbered(
  items: { id: string; status: string }[],
  page = 1,
  totalCount = 151,
  newCount = 0,
  snapshot = "snapshot-A",
) {
  return {
    items,
    page,
    pageSize: 50,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / 50)),
    newCount,
    snapshot,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mocked.read.mockReset();
  mocked.states.clear();
  mocked.callbacks.clear();
});
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
  mocked.callbacks.clear();
});

describe("shared numbered submission history", () => {
  it("updates a pending result on page two while preserving its page and snapshot", async () => {
    let accepted = false;
    mocked.read.mockImplementation(async (url: string) => {
      const page = Number(new URL(url, "http://localhost").searchParams.get("page"));
      return numbered(
        [
          {
            id: `submission-page-${page}`,
            status: page === 2 && !accepted ? "running" : "accepted",
          },
        ],
        page,
      );
    });
    const target = mountHistory();
    await refresh();
    await click(target, "Next");
    await vi.waitFor(() =>
      expect(target.querySelector('[data-row="submission-page-2"]')?.textContent).toBe(
        "running",
      ),
    );
    accepted = true;
    publishState("submission-page-2", "accepted");
    await refresh();
    expect(target.querySelector("[data-page]")?.textContent).toBe("2");
    expect(target.querySelector('[data-row="submission-page-2"]')?.textContent).toBe(
      "accepted",
    );
    expect(mocked.read.mock.lastCall?.[0]).toContain("page=2&snapshot=snapshot-A");
  });

  it("exposes all 151 records and keeps new arrivals behind an explicit latest action", async () => {
    let arrivals = 0;
    const all = Array.from({ length: 151 }, (_, i) => ({ id: `s${i}`, status: "accepted" }));
    mocked.read.mockImplementation(async (url: string) => {
      const params = new URL(url, "http://localhost").searchParams;
      const page = Number(params.get("page"));
      const fresh = !params.has("snapshot") && arrivals > 0;
      return numbered(
        fresh ? [{ id: "new", status: "accepted" }] : all.slice((page - 1) * 50, page * 50),
        page,
        fresh ? 152 : 151,
        fresh ? 0 : arrivals,
        fresh ? "snapshot-new" : "snapshot-A",
      );
    });
    const target = mountHistory();
    await refresh();
    const ids = [...target.querySelectorAll<HTMLElement>("[data-row]")].map(
      (row) => row.dataset.row,
    );
    for (let page = 2; page <= 4; page += 1) {
      await click(target, "Next");
      await vi.waitFor(() =>
        expect(target.querySelector("[data-page]")?.textContent).toBe(String(page)),
      );
      await vi.waitFor(() =>
        expect(target.querySelector("[data-loading]")?.textContent).toBe("false"),
      );
      ids.push(
        ...[...target.querySelectorAll<HTMLElement>("[data-row]")].map(
          (row) => row.dataset.row,
        ),
      );
    }
    expect(ids).toEqual(all.map((row) => row.id));
    arrivals = 1;
    await refresh();
    expect(target.querySelector("[data-page]")?.textContent).toBe("4");
    expect(target.querySelector("[data-new]")?.textContent).toBe("1");
    expect(target.querySelector('[data-row="s150"]')).not.toBeNull();
    await click(target, "Latest");
    await vi.waitFor(() => expect(target.querySelector('[data-row="new"]')).not.toBeNull());
    expect(target.querySelector("[data-page]")?.textContent).toBe("1");
    expect(
      new URL(mocked.read.mock.lastCall?.[0], "http://localhost").searchParams.has("snapshot"),
    ).toBe(false);
  });

  it("preserves a disappearing fourth page until an explicit refresh", async () => {
    let total = 151;
    mocked.read.mockImplementation(async (url: string) => {
      const page = Number(new URL(url, "http://localhost").searchParams.get("page"));
      return numbered([{ id: `page-${page}`, status: "accepted" }], page, total);
    });
    const target = mountHistory();
    await refresh();
    await click(target, "Fourth");
    await vi.waitFor(() => expect(target.querySelector('[data-row="page-4"]')).not.toBeNull());
    total = 51;
    await refresh();
    expect(target.querySelector("[data-page]")?.textContent).toBe("4");
    expect(target.querySelector('[data-row="page-4"]')).not.toBeNull();
    await click(target, "Retry");
    await vi.waitFor(() => expect(target.querySelector('[data-row="page-2"]')).not.toBeNull());
    expect(target.querySelector("[data-page]")?.textContent).toBe("2");
    expect(target.querySelector('[data-row="page-2"]')).not.toBeNull();
    expect(mocked.read.mock.lastCall?.[0]).toContain("page=2&snapshot=snapshot-A");
  });
  it("updates a filtered row without replacing page membership or counts until manual refresh", async () => {
    mocked.read.mockResolvedValue(numbered([{ id: "running", status: "running" }], 1, 51));
    const target = mountHistory("context=exam&id=A&status=running");
    await refresh();
    mocked.read.mockResolvedValue(numbered([{ id: "older", status: "running" }], 1, 50));
    publishState("running", "accepted");
    await refresh();
    expect(target.querySelector('[data-row="running"]')?.textContent).toBe("accepted");
    expect(target.querySelector('[data-row="older"]')).toBeNull();
    expect(target.querySelector("[data-total]")?.textContent).toBe("51");
    expect(target.querySelector("[data-pages]")?.textContent).toBe("2");
    publishState("running", "queued", 0);
    await tick();
    expect(target.querySelector('[data-row="running"]')?.textContent).toBe("accepted");
    await click(target, "Retry");
    await vi.waitFor(() => expect(target.querySelector('[data-row="older"]')).not.toBeNull());
    expect(target.querySelector('[data-row="running"]')).toBeNull();
    expect(target.querySelector("[data-total]")?.textContent).toBe("50");
  });

  it("surfaces background failures to the shared retry scheduler while retaining rows", async () => {
    mocked.read.mockResolvedValue(numbered([{ id: "retained", status: "accepted" }], 1, 1));
    const target = mountHistory();
    await refresh();
    mocked.read.mockRejectedValue(new Error("offline"));
    await expect(refresh()).rejects.toThrow("offline");
    await tick();
    expect(target.querySelector('[data-row="retained"]')).not.toBeNull();
    expect(target.querySelector("[data-failed]")?.textContent).toBe("true");
  });
});

describe("teacher submission feed context isolation", () => {
  it("rejects a delayed A response after the mounted feed switches to B", async () => {
    const late = deferred<unknown>();
    mocked.read.mockImplementation((url: string) =>
      new URL(url, "http://localhost").searchParams.get("id") === "A"
        ? late.promise
        : Promise.resolve(numbered([feedRow("B", "Problem B")], 1, 1)),
    );
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(ContextFeed, {
      target,
      props: {
        initialRows: [feedRow("A", "Problem A")],
        initialUrl: "/api/submissions?context=exam&id=A",
      },
    });
    cleanup.push(async () => {
      await unmount(component);
      target.remove();
    });
    await tick();
    const aRefresh = refresh();
    await vi.waitFor(() => expect(mocked.read).toHaveBeenCalledOnce());
    const aSignal = mocked.read.mock.calls[0]?.[1] as AbortSignal;
    component.changeContext("/api/submissions?context=exam&id=B", [feedRow("B", "Problem B")]);
    await refresh();
    expect(aSignal.aborted).toBe(true);
    expect(target.textContent).toContain("Problem B");
    late.resolve(numbered([feedRow("old-A", "Delayed Problem A")], 1, 1));
    await aRefresh;
    await tick();
    expect(target.textContent).toContain("Problem B");
    expect(target.textContent).not.toContain("Delayed Problem A");
  });
});

function feedRow(id: string, title: string) {
  return {
    id,
    createdAt: "2026-09-21T00:00:00Z",
    updatedAt: "2026-09-21T00:00:00Z",
    judgeGeneration: 1,
    ipAddress: "127.0.0.1",
    language: "python" as const,
    score: 100,
    status: "accepted",
    problem: { id, title },
    user: { id: "user", name: "Student", username: "student" },
  };
}

function publishState(id: string, status: SubmissionOperation["status"], generation = 1) {
  for (const { ids, listener } of mocked.states) {
    if (!ids.includes(id)) continue;
    listener({
      submissionId: id,
      problemId: "problem",
      problemTitle: "Problem",
      status,
      judgeGeneration: generation,
      updatedAt: "2026-09-21T01:00:00.000Z",
      result: null,
    });
  }
}
