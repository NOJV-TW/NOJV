// @vitest-environment jsdom

import { mount, unmount, tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import RejudgeDialog from "$lib/components/features/problem/admin/RejudgeDialog.svelte";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("$lib/stores/toast", () => ({
  toasts: { success: mocks.toastSuccess, error: mocks.toastError },
}));

let target: HTMLDivElement;
let component: ReturnType<typeof mount>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", mocks.fetch);
  target = document.createElement("div");
  document.body.append(target);
});
afterEach(async () => {
  if (component) await unmount(component);
  target.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function start(initial = { status: "running", completed: 2, total: 5 }) {
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
    await vi.advanceTimersByTimeAsync(1500);
    await tick();
    expect(body()).toContain(m.rejudge_progress_status({ completed: 2, total: 5 }));
    expect(body()).toContain(m.rejudge_progress_unavailable());
    expect(cancelButton()).toBeDefined();

    mocks.fetch.mockResolvedValueOnce(
      Response.json({ status: "completed", completed: 5, total: 5 }),
    );
    await vi.advanceTimersByTimeAsync(1500);
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
    await vi.advanceTimersByTimeAsync(1500);
    await tick();
    expect(body()).toContain(m.rejudge_progress_cancelled());
  });
});
