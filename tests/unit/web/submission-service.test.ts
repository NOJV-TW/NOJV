// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSubmissionBody,
  executeSubmission,
  waitForPendingSubmissions,
} from "$lib/services/submission-service";

import { stopSubmissionTracking } from "$lib/services/submission-tracker";
vi.mock("$app/navigation", () => ({
  invalidateAll: vi.fn().mockResolvedValue(undefined),
  invalidate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("$lib/stores/toast", () => ({ toasts: { success: vi.fn(), info: vi.fn() } }));
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => {
  stopSubmissionTracking();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("buildSubmissionBody", () => {
  it("serializes virtual submissions with participationId", () => {
    const body = buildSubmissionBody({
      context: { type: "virtual", participationId: "participation_1" },
      language: "cpp",
      problemId: "problem_1",
      sampleOnly: false,
      sourceCode: "int main() {}",
    });

    expect(body).toMatchObject({
      context: { type: "virtual", participationId: "participation_1" },
      language: "cpp",
      problemId: "problem_1",
      sampleOnly: false,
      sourceCode: "int main() {}",
    });
    expect(body).not.toHaveProperty("participationId");
  });

  it("omits redundant sourceCode when source files provide the submission", () => {
    const body = buildSubmissionBody({
      context: { type: "practice" },
      language: "cpp",
      problemId: "problem_1",
      sourceCode: "// advanced-mode upload",
      sourceFiles: [{ path: "main.cpp", content: "int main() {}" }],
    });

    expect(body).toMatchObject({
      context: { type: "practice" },
      sourceFiles: [{ path: "main.cpp", content: "int main() {}" }],
    });
    expect(body).not.toHaveProperty("sourceCode");
  });

  it("marks a practice submission as a reference solution", () => {
    const body = buildSubmissionBody({
      context: { type: "practice" },
      language: "python",
      problemId: "problem_1",
      referenceSolution: true,
      sourceCode: "print(1)",
    });

    expect(body).toMatchObject({ referenceSolution: true, sampleOnly: false });
  });
});

describe("executeSubmission", () => {
  const request = {
    context: { type: "practice" as const },
    language: "python" as const,
    problemId: "a",
    sourceCode: "print(1)",
  };
  const result = {
    accepted: true,
    verdict: "accepted",
    score: 100,
    runtimeMs: 0,
    feedback: "Accepted",
  };
  const operation = {
    submissionId: "s",
    problemId: "a",
    problemTitle: "A",
    judgeGeneration: 1,
    updatedAt: "2026-09-21T00:00:00Z",
    status: "accepted",
    result,
  };
  const response = (value: unknown) => new Response(JSON.stringify(value));
  it("keeps the dispatch POST alive across navigation so hand-in can wait for it", async () => {
    let respond!: (value: Response) => void;
    let postSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        postSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => (respond = resolve));
      }),
    );
    const pending = executeSubmission(request).catch(() => null);
    await vi.advanceTimersByTimeAsync(0);
    stopSubmissionTracking();
    let waited = false;
    const wait = waitForPendingSubmissions().then(() => (waited = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(postSignal?.aborted).toBe(false);
    expect(waited).toBe(false);
    respond(response({ submissionId: "s", pollUrl: "/detail", status: "queued" }));
    await wait;
    await pending;
    expect(waited).toBe(true);
  });
  it("retries transport errors through the shared observer and retrieves terminal detail", async () => {
    let reads = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST")
        return response({ submissionId: "s", pollUrl: "/detail", status: "queued" });
      if (url === "/detail") return response(operation);
      if (reads++ === 0) throw new TypeError("network");
      return response({ items: [operation], unavailableIds: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const pending = executeSubmission(request);
    await vi.advanceTimersByTimeAsync(10001);
    await expect(pending).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("does not accept a previous result while the operation is running", async () => {
    let status = "running";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST")
          return response({ submissionId: "s", pollUrl: "/detail", status: "queued" });
        if (url === "/detail") return response(operation);
        return response({ items: [{ ...operation, status }], unavailableIds: [] });
      }),
    );
    const done = vi.fn();
    const pending = executeSubmission(request).then(done);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).not.toHaveBeenCalled();
    status = "accepted";
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(done).toHaveBeenCalledWith(result);
  });
  it.each(["system_error", "accepted"])(
    "waits for recovering %s until its execution completes",
    async (status) => {
      let state = "recovering";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          if (init?.method === "POST")
            return response({ submissionId: "s", pollUrl: "/detail", status: "queued" });
          if (url === "/detail") return response(operation);
          return response({
            items: [
              {
                ...operation,
                status,
                execution: {
                  state,
                  generation: 1,
                  problemGeneration: 1,
                  reasonCode: null,
                  lastProgressAt: operation.updatedAt,
                  nextRetryAt: null,
                },
              },
            ],
            unavailableIds: [],
          });
        }),
      );
      const done = vi.fn();
      const pending = executeSubmission(request).then(done);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).not.toHaveBeenCalled();
      state = "completed";
      await vi.advanceTimersByTimeAsync(5000);
      await pending;
      expect(done).toHaveBeenCalledWith(result);
    },
  );
  it("does not turn a transient read failure into a judge verdict", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? response({ submissionId: "s", pollUrl: "/detail", status: "queued" })
          : new Response("unavailable", { status: 503 }),
      ),
    );
    const pending = executeSubmission(request, { timeoutMs: 1000 });
    const assertion = expect(pending).rejects.toMatchObject({ code: "SUBMISSION_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});
