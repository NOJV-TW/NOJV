import { stopSubmissionTracking } from "$lib/services/submission-tracker";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorRunController } from "$lib/components/features/problem/editors/use-editor-run.svelte";

const mocks = vi.hoisted(() => ({ refresh: vi.fn().mockResolvedValue(undefined) }));
vi.mock("$app/navigation", () => ({ invalidateAll: mocks.refresh, invalidate: mocks.refresh }));
vi.mock("$lib/services/browser-local-run", () => ({}));
vi.mock("$lib/stores/sse", () => ({ watchSubmissionVerdict: () => () => undefined }));
vi.mock("$lib/stores/toast", () => ({
  toasts: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

afterEach(() => {
  stopSubmissionTracking();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function editor() {
  const complete = vi.fn();
  const dispatched = vi.fn();
  return {
    complete,
    dispatched,
    controller: createEditorRunController({
      problemId: "problem_a",
      initialSamples: [],
      language: () => "python",
      isWorkspaceMode: () => false,
      isSpecialEnv: () => false,
      judgeType: () => "standard",
      judgeConfig: () => ({ type: "standard" }),
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      drafts: () => ({ python: "print(1)" }),
      workspaceDrafts: () => ({}),
      workspaceFiles: () => [],
      context: () => ({ type: "exam", examId: "exam_1" }),
      onSubmissionDispatched: dispatched,
      onSubmissionComplete: complete,
    }),
  };
}
const result = {
  accepted: true,
  verdict: "accepted",
  score: 100,
  runtimeMs: 1,
  feedback: "Accepted",
};
const dispatch = () =>
  new Response(
    JSON.stringify({ submissionId: "submission_a", pollUrl: "/poll", status: "queued" }),
    { status: 202 },
  );
const operation = {
  submissionId: "submission_a",
  problemId: "problem_a",
  problemTitle: "A",
  status: "accepted",
  judgeGeneration: 1,
  updatedAt: "2026-09-21T00:00:01Z",
  result,
};
const verdict = (url: string) =>
  new Response(
    JSON.stringify(
      url.includes("/status?") ? { items: [operation], unavailableIds: [] } : operation,
    ),
  );

describe("submission survives navigation", () => {
  it.each(["dispatch", "judging"])(
    "continues through %s and refreshes the new page",
    async (phase) => {
      let held = false;
      let release!: (response: Response) => void;
      let signal: AbortSignal | undefined;
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      const fetchMock = vi.fn((url, init) => {
        if (
          (phase === "dispatch" && init.method === "POST") ||
          (phase === "judging" && init.method !== "POST" && !held)
        ) {
          held = true;
          signal = init.signal;
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        }
        return Promise.resolve(init.method === "POST" ? dispatch() : verdict(url));
      });
      vi.stubGlobal("fetch", fetchMock);
      const { controller, complete, dispatched } = editor();
      const pending = controller.submit();
      await vi.waitFor(() => expect(release).toBeDefined());
      controller.markDestroyed();
      const wasAborted = signal?.aborted;
      release(phase === "dispatch" ? dispatch() : verdict("/status?"));
      await pending;
      expect(wasAborted).toBe(false);
      expect(complete).not.toHaveBeenCalled();
      if (phase === "dispatch") expect(dispatched).not.toHaveBeenCalled();
      expect(mocks.refresh).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );
});
