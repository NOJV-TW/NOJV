import { beforeEach, describe, expect, it, vi } from "vitest";

const createQueuedSubmissionRecord = vi.fn();
const createQueuedWorkspaceRunRecord = vi.fn();
const dispatchSubmissionJob = vi.fn();
const dispatchWorkspaceRunJob = vi.fn();

vi.mock("@/lib/server/actor-context", () => ({
  getActorContext: vi.fn(() => ({
    displayName: "POC Student",
    email: "student.poc@nojv.local",
    handle: "student_poc",
    platformRole: "student",
    userId: "usr_demo_problem_editor"
  }))
}));

vi.mock("@/lib/server/poc-persistence", () => ({
  createQueuedSubmissionRecord,
  createQueuedWorkspaceRunRecord
}));

vi.mock("@/lib/server/queue", () => ({
  dispatchSubmissionJob,
  dispatchWorkspaceRunJob
}));

describe("judge operation dispatch routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 202 and a poll URL when a submission is queued", async () => {
    createQueuedSubmissionRecord.mockResolvedValue({
      id: "sub_test_queued_01",
      status: "queued"
    });
    dispatchSubmissionJob.mockResolvedValue(undefined);

    const { POST } = await import("../src/app/api/submissions/route");
    const response = await POST(
      new Request("http://localhost/api/submissions", {
        body: JSON.stringify({
          language: "cpp",
          mode: "practice",
          problemSlug: "warmup-sum",
          sourceCode: "int main() { return 0; }"
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      })
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      pollUrl: "/api/submissions/sub_test_queued_01",
      status: "queued",
      submissionId: "sub_test_queued_01"
    });
  });

  it("returns 202 and a poll URL when a workspace run is queued", async () => {
    createQueuedWorkspaceRunRecord.mockResolvedValue({
      id: "run_test_queued_01",
      status: "queued"
    });
    dispatchWorkspaceRunJob.mockResolvedValue(undefined);

    const { POST } = await import("../src/app/api/workspace/runs/route");
    const response = await POST(
      new Request("http://localhost/api/workspace/runs", {
        body: JSON.stringify({
          command: "make run",
          files: [
            {
              content: "run:\n\t@echo ok\n",
              path: "Makefile"
            }
          ],
          mode: "assignment",
          timeoutMs: 3_000,
          workspaceSessionId: "ws_async_queue_01"
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      })
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      pollUrl: "/api/workspace/runs/run_test_queued_01",
      status: "queued",
      workspaceRunId: "run_test_queued_01"
    });
  });

  it("exposes a submission polling route", async () => {
    const routeModule = await import("../src/app/api/submissions/[submissionId]/route");

    expect(typeof routeModule.GET).toBe("function");
  });

  it("exposes a workspace run polling route", async () => {
    const routeModule = await import("../src/app/api/workspace/runs/[runId]/route");

    expect(typeof routeModule.GET).toBe("function");
  });
});
