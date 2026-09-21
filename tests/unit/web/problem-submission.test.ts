// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SubmissionOperation } from "@nojv/core";
import { applySubmissionState, mergeSubmissionEntries } from "$lib/services/problem-submission";
import {
  startSubmissionTracking,
  stopSubmissionTracking,
  watchSubmissionStates,
  watchRejudge,
} from "$lib/services/submission-tracker";
const mocks = vi.hoisted(() => ({
  refresh: vi.fn().mockResolvedValue(undefined),
  toast: vi.fn(),
  event: vi.fn(),
  open: vi.fn(),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: mocks.refresh, invalidate: mocks.refresh }));
vi.mock("$lib/stores/sse", () => ({ onSSEEvent: mocks.event, onSSEOpen: mocks.open }));
vi.mock("$lib/stores/toast", () => ({ toasts: { success: mocks.toast, info: mocks.toast } }));
const releases: (() => void)[] = [];
const operation = (
  id = "s",
  status: SubmissionOperation["status"] = "running",
  generation = 1,
): SubmissionOperation => ({
  submissionId: id,
  problemId: "a",
  problemTitle: "A",
  status,
  judgeGeneration: generation,
  updatedAt: `2026-09-21T00:00:0${generation}.000Z`,
  result:
    status === "running"
      ? null
      : {
          accepted: status === "accepted",
          verdict: status === "system_error" ? "system_error" : "accepted",
          score: status === "accepted" ? 100 : 0,
          runtimeMs: 0,
          feedback: status,
        },
});
const json = (value: unknown) => new Response(JSON.stringify(value));
beforeEach(() => {
  vi.useFakeTimers();
  mocks.refresh.mockResolvedValue(undefined);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  mocks.event.mockReturnValue(() => undefined);
  mocks.open.mockReturnValue(() => undefined);
});
afterEach(() => {
  releases.splice(0).forEach((stop) => stop());
  stopSubmissionTracking();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("batches 151 observed entries into two requests and refreshes older entries", async () => {
  let done = false;
  const receive = vi.fn();
  const fetchMock = vi.fn(async (url: string) =>
    json({
      items: decodeURIComponent(url.split("ids=")[1]!)
        .split(",")
        .map((id) => operation(id, done ? "accepted" : "running")),
      unavailableIds: [],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  releases.push(
    watchSubmissionStates(
      Array.from({ length: 151 }, (_, i) => `s${i}`),
      receive,
    ),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  done = true;
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(receive).toHaveBeenCalledWith(
    expect.objectContaining({ submissionId: "s150", status: "accepted" }),
  );
});
it("restores A after reloading on B and coalesces repeated completion signals", async () => {
  let done = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/pending")
        ? json({ items: done ? [] : [operation()], nextCursor: null })
        : json({ items: [operation("s", done ? "accepted" : "running")], unavailableIds: [] }),
    ),
  );
  releases.push(startSubmissionTracking("u"));
  await vi.advanceTimersByTimeAsync(0);
  done = true;
  const event = mocks.event.mock.calls[0]![1];
  event({ type: "submission:verdict", submissionId: "s" });
  event({ type: "submission:verdict", submissionId: "s" });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.toast).toHaveBeenCalledTimes(1);
  expect(mocks.toast).toHaveBeenCalledWith("A: AC · 100");
  expect(mocks.refresh).toHaveBeenCalledWith("submission:data");
});
it("terminal system error is delivered even without a detail object", async () => {
  const receive = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({
        items: [{ ...operation("s", "system_error"), result: null }],
        unavailableIds: [],
      }),
    ),
  );
  releases.push(watchSubmissionStates(["s"], receive));
  await vi.advanceTimersByTimeAsync(0);
  expect(receive).toHaveBeenCalledWith(
    expect.objectContaining({ status: "system_error", result: null }),
  );
});
it("a stalled request times out and later polling recovers", async () => {
  const receive = vi.fn();
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener("abort", () => reject(new Error("timeout"))),
        ),
    )
    .mockImplementation(async () =>
      json({ items: [operation("s", "accepted")], unavailableIds: [] }),
    );
  vi.stubGlobal("fetch", fetchMock);
  releases.push(watchSubmissionStates(["s"], receive));
  await vi.advanceTimersByTimeAsync(20000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(receive).toHaveBeenCalledWith(expect.objectContaining({ status: "accepted" }));
});
it("ignores older generations and clears a previous AC when a newer run starts", () => {
  const row = {
    id: "s",
    language: "python",
    submittedAt: "2026-09-21",
    status: "accepted" as const,
    judgeGeneration: 1,
    updatedAt: operation().updatedAt,
    result: operation("s", "accepted").result!,
  };
  const pending = applySubmissionState(row, operation("s", "running", 2));
  expect(pending.result).toBeUndefined();
  expect(pending.status).toBe("running");
  expect(applySubmissionState(pending, operation("s", "accepted", 1))).toBe(pending);
  expect(mergeSubmissionEntries([row], [{ ...pending }])[0]?.result).toBeUndefined();
});
it("reconnect and foreground perform reconciliation without waiting for another event", async () => {
  const fetchMock = vi.fn(async () => json({ items: [], nextCursor: null }));
  vi.stubGlobal("fetch", fetchMock);
  releases.push(startSubmissionTracking("u"));
  await vi.advanceTimersByTimeAsync(0);
  fetchMock.mockClear();
  mocks.open.mock.calls[0]![0]();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalled();
  fetchMock.mockClear();
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalled();
});
it("a disposed account cannot apply an old in-flight response", async () => {
  let finish!: (value: Response) => void;
  const receive = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  releases.push(watchSubmissionStates(["s"], receive));
  await vi.advanceTimersByTimeAsync(0);
  stopSubmissionTracking();
  finish(json({ items: [operation("s", "accepted")], unavailableIds: [] }));
  await vi.advanceTimersByTimeAsync(0);
  expect(receive).not.toHaveBeenCalled();
});

it("late duplicate verdicts and workflow completion do not retain completed tracking IDs", async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url.includes("/pending")
      ? json({ items: [], nextCursor: null })
      : url.includes("/rejudges/")
        ? json({ status: "completed", completed: 1, total: 1 })
        : json({ items: [operation("s", "accepted")], unavailableIds: [] }),
  );
  vi.stubGlobal("fetch", fetchMock);
  releases.push(startSubmissionTracking("u"));
  const event = mocks.event.mock.calls[0]![1];
  event({ type: "submission:verdict", submissionId: "s" });
  await vi.advanceTimersByTimeAsync(0);
  event({ type: "submission:verdict", submissionId: "s" });
  releases.push(watchRejudge("workflow", ["s"], vi.fn()));
  await vi.advanceTimersByTimeAsync(1);
  const count = fetchMock.mock.calls.filter(([url]) => url.includes("/status?")).length;
  await vi.advanceTimersByTimeAsync(20000);
  expect(fetchMock.mock.calls.filter(([url]) => url.includes("/status?"))).toHaveLength(count);
  expect(mocks.toast).toHaveBeenCalledTimes(1);
});
it("a stalled route invalidation never blocks status observation", async () => {
  mocks.refresh.mockReturnValue(new Promise(() => undefined));
  let done = false;
  const receive = vi.fn();
  const fetchMock = vi.fn(async () =>
    json({ items: [operation("s", done ? "accepted" : "running")], unavailableIds: [] }),
  );
  vi.stubGlobal("fetch", fetchMock);
  releases.push(watchSubmissionStates(["s"], receive));
  await vi.advanceTimersByTimeAsync(0);
  done = true;
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(receive).toHaveBeenCalledWith(expect.objectContaining({ status: "accepted" }));
});
