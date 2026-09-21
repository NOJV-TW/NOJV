// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import { executeSubmission } from "$lib/services/submission-service";

import {
  requestSubmissionRefresh,
  stopSubmissionTracking,
} from "$lib/services/submission-tracker";
vi.mock("$app/navigation", () => ({
  invalidateAll: vi.fn().mockResolvedValue(undefined),
  invalidate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("$lib/stores/toast", () => ({ toasts: { success: vi.fn(), info: vi.fn() } }));
const request = {
  context: { type: "practice" as const },
  language: "python" as const,
  problemId: "deadline",
  sourceCode: "print(42)",
};
const dispatch = () =>
  new Response(JSON.stringify({ submissionId: "s1", pollUrl: "/poll", status: "queued" }));
const pending = () =>
  new Response(
    JSON.stringify({
      items: [
        {
          submissionId: "s1",
          problemId: "deadline",
          problemTitle: "Deadline",
          judgeGeneration: 1,
          updatedAt: "2026-09-21T00:00:00.000Z",
          status: "queued",
          result: null,
        },
      ],
      unavailableIds: [],
    }),
  );
const hang = (_url: unknown, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener(
      "abort",
      () => reject(new DOMException("Aborted", "AbortError")),
      { once: true },
    );
  });
afterEach(() => {
  stopSubmissionTracking();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(["dispatch", "poll"])(
  "enforces the deadline during a stalled %s request",
  async (stage) => {
    vi.useFakeTimers();
    const fetch = vi.fn(hang);
    if (stage === "poll") fetch.mockImplementationOnce(async () => dispatch());
    vi.stubGlobal("fetch", fetch);
    const result = expect(executeSubmission(request, { timeoutMs: 100 })).rejects.toMatchObject(
      { code: "SUBMISSION_TIMEOUT" },
    );
    await vi.advanceTimersByTimeAsync(100);
    await result;
  },
);

it("consumes an early verdict notification instead of busy-polling forever", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const fetch = vi
    .fn()
    .mockImplementationOnce(async () => dispatch())
    .mockImplementation(async () => pending());
  vi.stubGlobal("fetch", fetch);
  const result = executeSubmission(request, { signal: controller.signal });
  await vi.advanceTimersByTimeAsync(0);
  requestSubmissionRefresh();
  requestSubmissionRefresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(499);
  expect(fetch).toHaveBeenCalledTimes(3);
  controller.abort();
  await expect(result).resolves.toBeNull();
  stopSubmissionTracking();
  expect(vi.getTimerCount()).toBe(0);
});
