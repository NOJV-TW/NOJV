import { beforeEach, describe, expect, it, vi } from "vitest";

const createQueuedSubmissionRecord = vi.fn();
const dispatchSubmissionJob = vi.fn();

vi.mock("@/lib/server/actor-context", () => ({
  getActorContext: vi.fn(() => ({
    displayName: "Local Student",
    email: "student.local@nojv.dev",
    handle: "student_local",
    platformRole: "student",
    userId: "usr_demo_problem_editor"
  }))
}));

vi.mock("@/lib/server/data-access/submissions", () => ({
  createQueuedSubmissionRecord
}));

vi.mock("@/lib/server/queue", () => ({
  dispatchSubmissionJob
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

  it("exposes a submission polling route", async () => {
    const routeModule = await import("../src/app/api/submissions/[submissionId]/route");

    expect(typeof routeModule.GET).toBe("function");
  });
});
