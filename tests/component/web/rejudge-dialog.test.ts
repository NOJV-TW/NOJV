// @vitest-environment jsdom

import { mount, unmount, tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopSubmissionTracking } from "$lib/services/submission-tracker";
import { m } from "$lib/paraglide/messages.js";
import RejudgeDialog from "$lib/components/features/problem/admin/RejudgeDialog.svelte";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: mocks.refresh, invalidate: mocks.refresh }));
vi.mock("$lib/stores/toast", () => ({
  toasts: { success: mocks.toastSuccess, error: mocks.toastError },
}));

let target: HTMLDivElement;
let component: ReturnType<typeof mount>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  vi.stubGlobal("fetch", mocks.fetch);
  target = document.createElement("div");
  document.body.append(target);
});
afterEach(async () => {
  if (component) await unmount(component);
  stopSubmissionTracking();
  target.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function start(initial = { status: "running", completed: 2, total: 5 }) {
  mocks.fetch.mockResolvedValueOnce(Response.json({ items: [] }));
  mocks.fetch.mockResolvedValueOnce(Response.json({ workflowId: "rejudge-test" }));
  mocks.fetch.mockResolvedValueOnce(Response.json(initial));
  component = mount(RejudgeDialog, {
    target,
    props: { problemId: "p1", open: true, onOpenChange: vi.fn() },
  });
  await tick();
  document.body
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(0);
  await tick();
}

function body() {
  return document.body.textContent ?? "";
}
function cancelButton() {
  return [...document.body.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(m.rejudge_progress_cancelBtn()),
  )!;
}

describe("RejudgeDialog progress", () => {
  it("retains progress and polling when a query fails, then clears the alert on recovery", async () => {
    await start();
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ message: "unavailable" }, { status: 503 }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    await tick();
    expect(body()).toContain(m.rejudge_progress_status({ completed: 2, total: 5 }));
    expect(body()).toContain(m.rejudge_progress_unavailable());
    expect(cancelButton()).toBeDefined();

    mocks.fetch.mockResolvedValueOnce(
      Response.json({ status: "completed", completed: 5, total: 5 }),
    );
    await vi.advanceTimersByTimeAsync(10000);
    await tick();
    expect(body()).toContain(m.rejudge_progress_done());
    expect(body()).not.toContain(m.rejudge_progress_unavailable());
    const calls = mocks.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.fetch).toHaveBeenCalledTimes(calls);
  });

  it.each(["failed", "cancelled"])(
    "shows %s as a terminal state without claiming completion",
    async (status) => {
      await start({ status, completed: 2, total: 5 });
      expect(body()).toContain(
        status === "failed" ? m.rejudge_progress_failed() : m.rejudge_progress_cancelled(),
      );
      expect(body()).not.toContain(m.rejudge_progress_done());
      const calls = mocks.fetch.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(mocks.fetch).toHaveBeenCalledTimes(calls);
    },
  );

  it("keeps polling after cancellation is requested until the server confirms cancellation", async () => {
    await start({ status: "running", completed: 0, total: 0 });
    mocks.fetch.mockResolvedValueOnce(Response.json({ status: "requested" }, { status: 202 }));
    cancelButton().click();
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(body()).toContain(m.rejudge_cancel_requested());
    expect(body()).toContain(m.rejudge_progress_running());
    expect(body()).not.toContain(m.rejudge_progress_cancelled());
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ status: "cancelled", completed: 0, total: 0 }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    await tick();
    expect(body()).toContain(m.rejudge_progress_cancelled());
  });
  it("recovers a queued workflow after the dialog is closed and reopened without starting another job", async () => {
    let progress = { status: "queued", completed: 0, total: 5 };
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      expect(init?.method).not.toBe("POST");
      return Response.json(
        url.startsWith("/api/rejudges?")
          ? { items: [{ workflowId: "existing", ...progress }] }
          : progress,
      );
    });
    const open = () =>
      mount(RejudgeDialog, {
        target,
        props: {
          problemId: "p1",
          open: true,
          scope: { type: "exam", id: "exam_1" },
          onOpenChange: vi.fn(),
        },
      });
    component = open();
    await tick();
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(body()).toContain(m.rejudge_progress_queued());
    await unmount(component);
    progress = { status: "running", completed: 3, total: 5 };
    await vi.advanceTimersByTimeAsync(5000);
    component = open();
    await tick();
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(body()).toContain(m.rejudge_progress_status({ completed: 3, total: 5 }));
    expect(body()).toContain(m.rejudge_progress_running());
    progress = { status: "completed", completed: 5, total: 5 };
    await vi.advanceTimersByTimeAsync(5000);
    await tick();
    expect(body()).toContain(m.rejudge_progress_done());
    expect(mocks.refresh).toHaveBeenCalledWith("submission:data");
  });
});
