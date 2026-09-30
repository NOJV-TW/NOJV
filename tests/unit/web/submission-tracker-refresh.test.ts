// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { JudgeExecutionView, SubmissionOperation } from "@nojv/core";

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn().mockResolvedValue(undefined),
  event: vi.fn(),
  open: vi.fn(),
}));
vi.mock("$app/navigation", () => ({ invalidate: mocks.invalidate, invalidateAll: vi.fn() }));
vi.mock("$lib/stores/sse", () => ({ onSSEEvent: mocks.event, onSSEOpen: mocks.open }));
vi.mock("$lib/stores/toast", () => ({ toasts: { success: vi.fn(), info: vi.fn() } }));

import { navigating } from "$app/state";
import {
  startSubmissionTracking,
  stopSubmissionTracking,
  watchSubmissionStates,
} from "$lib/services/submission-tracker";

const pendingNavigation = navigating as { to: unknown };
const operation = (
  id: string,
  status: SubmissionOperation["status"],
  generation = 1,
): SubmissionOperation => ({
  submissionId: id,
  problemId: "p",
  problemTitle: "P",
  status,
  judgeGeneration: generation,
  updatedAt: `2026-09-21T00:00:0${generation}.000Z`,
  result:
    status === "queued" || status === "running"
      ? null
      : {
          accepted: status === "accepted",
          verdict: "accepted",
          score: 100,
          runtimeMs: 0,
          feedback: status,
        },
});
const execution = (state: JudgeExecutionView["state"]): JudgeExecutionView => ({
  state,
  generation: 1,
  problemGeneration: 1,
  reasonCode: null,
  lastProgressAt: "2026-09-21T00:00:01.000Z",
  nextRetryAt: null,
});
const json = (value: unknown) => new Response(JSON.stringify(value));

let pending: SubmissionOperation[] = [];
let states = new Map<string, SubmissionOperation>();
const fetchMock = vi.fn(async (url: string) => {
  if (url.includes("/pending")) return json({ items: pending, nextCursor: null });
  const ids = decodeURIComponent(url.split("ids=")[1] ?? "").split(",");
  return json({
    items: ids.flatMap((id) => states.get(id) ?? []),
    unavailableIds: ids.filter((id) => !states.has(id)),
  });
});
const pendingCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes("/pending")).length;
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  pending = [];
  states = new Map();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  mocks.event.mockReturnValue(() => undefined);
  mocks.open.mockReturnValue(() => undefined);
});

afterEach(() => {
  stop?.();
  stop = undefined;
  pendingNavigation.to = null;
  stopSubmissionTracking();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("backs off to 30 s and never invalidates while nothing is pending", async () => {
  stop = startSubmissionTracking("u");
  await vi.advanceTimersByTimeAsync(0);
  expect(pendingCalls()).toBe(1);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(pendingCalls()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(pendingCalls()).toBe(2);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(pendingCalls()).toBe(6);
  expect(mocks.invalidate).not.toHaveBeenCalled();
});

it("polls every 5 s while a submission is judging but only invalidates on change", async () => {
  pending = [operation("s", "running")];
  stop = startSubmissionTracking("u");
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(pendingCalls()).toBe(4);
  expect(mocks.invalidate).not.toHaveBeenCalled();

  pending = [];
  states.set("s", operation("s", "accepted", 2));
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  expect(mocks.invalidate).toHaveBeenCalledWith("submission:data");

  const settled = pendingCalls();
  await vi.advanceTimersByTimeAsync(29_999);
  expect(pendingCalls()).toBe(settled);
  await vi.advanceTimersByTimeAsync(1);
  expect(pendingCalls()).toBe(settled + 1);
  expect(mocks.invalidate).toHaveBeenCalledTimes(1);
});

it("invalidates when the pending set gains a submission from another tab", async () => {
  stop = startSubmissionTracking("u");
  await vi.advanceTimersByTimeAsync(0);
  pending = [operation("other", "queued")];
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocks.invalidate).toHaveBeenCalledTimes(1);
});

it("an SSE verdict for an unseen submission refreshes the page immediately", async () => {
  stop = startSubmissionTracking("u");
  await vi.advanceTimersByTimeAsync(0);
  states.set("s", operation("s", "accepted"));
  const onVerdict = mocks.event.mock.calls[0]![1] as (event: unknown) => void;
  onVerdict({ type: "submission:verdict", submissionId: "s" });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.invalidate).toHaveBeenCalledTimes(1);

  onVerdict({ type: "submission:verdict", submissionId: "s" });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.invalidate).toHaveBeenCalledTimes(1);
});

it("defers a changed verdict during navigation and applies it within 5 s", async () => {
  pending = [operation("s", "running")];
  stop = startSubmissionTracking("u");
  await vi.advanceTimersByTimeAsync(0);

  pending = [];
  states.set("s", operation("s", "accepted", 2));
  pendingNavigation.to = { url: new URL("http://localhost/problems/p") };
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.invalidate).not.toHaveBeenCalled();

  pendingNavigation.to = null;
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.invalidate).toHaveBeenCalledTimes(1);
});

it("refreshes a page whose first poll differs from the state it rendered", async () => {
  const rendered = { ...operation("s", "accepted"), execution: execution("waiting_capacity") };
  states.set("s", { ...rendered, execution: execution("running") });
  const release = watchSubmissionStates(["s"], () => undefined, [rendered]);
  const stopTracking = startSubmissionTracking("u");
  stop = () => {
    release();
    stopTracking();
  };
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.invalidate).toHaveBeenCalledTimes(1);
});

it("does not refresh a page whose first poll matches the state it rendered", async () => {
  const rendered = { ...operation("s", "accepted"), execution: execution("waiting_capacity") };
  states.set("s", rendered);
  const release = watchSubmissionStates(["s"], () => undefined, [rendered]);
  const stopTracking = startSubmissionTracking("u");
  stop = () => {
    release();
    stopTracking();
  };
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.invalidate).not.toHaveBeenCalled();
});
