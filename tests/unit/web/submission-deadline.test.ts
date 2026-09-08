import { afterEach, expect, it, vi } from "vitest";
import { executeSubmission } from "$lib/services/submission-service";

let notifyVerdict: (() => void) | undefined;
vi.mock("$lib/stores/sse", () => ({
  watchSubmissionVerdict: (_id: string, callback: () => void) => {
    notifyVerdict = callback;
    return () => {};
  },
}));
const request = {
  context: { type: "practice" as const },
  language: "python" as const,
  problemId: "deadline",
  sourceCode: "print(42)",
};
const dispatch = () =>
  new Response(JSON.stringify({ submissionId: "s1", pollUrl: "/poll", status: "queued" }));
const pending = () =>
  new Response(JSON.stringify({ submissionId: "s1", status: "queued", result: null }));
const hang = (_url: unknown, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener(
      "abort",
      () => reject(new DOMException("Aborted", "AbortError")),
      { once: true },
    );
  });
afterEach(() => {
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
  notifyVerdict!();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(499);
  expect(fetch).toHaveBeenCalledTimes(3);
  controller.abort();
  await expect(result).resolves.toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
