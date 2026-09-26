import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRejudgeCandidates: vi.fn(),
  recordRejudgeProgress: vi.fn(),
  findByWorkflowId: vi.fn(),
  findJudgeExecutions: vi.fn(),
  logError: vi.fn(),
  actor: { userId: "owner", platformRole: "teacher" },
}));

vi.mock("$lib/server/logger", () => ({ createLogger: () => ({ error: mocks.logError }) }));

vi.mock("@nojv/db", () => ({
  durableWorkRepo: {
    listRejudgeCandidates: mocks.listRejudgeCandidates,
    recordRejudgeProgress: mocks.recordRejudgeProgress,
    findByWorkflowId: mocks.findByWorkflowId,
  },
  prismaAdapterClient: { judgeExecution: { findMany: mocks.findJudgeExecutions } },
}));
vi.mock("$lib/server/auth", async () => ({
  HttpError: (await import("@nojv/application")).HttpError,
  requireApiAuth: () => mocks.actor,
}));
vi.mock("$lib/server/shared/rate-limiter", () => ({
  apiRateLimiter: { consume: async () => "allowed" },
  writeApiRateLimiter: { consume: async () => "allowed" },
  registryTokenRateLimiter: { consume: async () => "allowed" },
}));

import { submissionDomain } from "@nojv/application";
import { GET } from "../../../apps/web/src/routes/api/rejudges/[workflowId]/+server";
import { POST } from "../../../apps/web/src/routes/api/rejudges/[workflowId]/cancel/+server";

const workflowId = "rejudge-test";
function event(method = "GET", id = workflowId): RequestEvent {
  const url = new URL(`https://nojv.test/api/rejudges/${id}`);
  return {
    params: { workflowId: id },
    request: new Request(url, { method }),
    url,
    locals: { requestId: "test-rejudge", sessionUser: { id: "owner" } },
  } as unknown as RequestEvent;
}
function work(options: { prepared?: boolean; result?: unknown } = {}) {
  return {
    status: "succeeded",
    attempt: 1,
    dedupeKey: workflowId,
    result: options.result ?? null,
    payload: {
      workflowId,
      ...(options.prepared === false ? {} : { prepared: true }),
      input: { mode: "batch", problemId: "p1", triggeredByUserId: "owner" },
    },
  };
}
function runs(...states: string[]) {
  return states.map((state) => ({ state }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.userId = "owner";
  mocks.actor.platformRole = "teacher";
  mocks.findByWorkflowId.mockResolvedValue(work());
  mocks.findJudgeExecutions.mockResolvedValue(runs("running"));
});

describe("rejudge state routes", () => {
  it("keeps target identity metadata inside the server", async () => {
    mocks.findByWorkflowId.mockResolvedValue(
      work({
        result: {
          status: "completed",
          completed: 1,
          total: 1,
          targets: [{ submissionId: "private-target", judgeGeneration: 4 }],
        },
      }),
    );
    const response = await GET(event());
    expect(await response.json()).toEqual({ status: "completed", completed: 1, total: 1 });
  });

  it.each([
    [["queued", "queued"], { status: "queued", completed: 0, total: 2 }],
    [["completed", "running"], { status: "running", completed: 1, total: 2 }],
    [["completed", "completed"], { status: "completed", completed: 2, total: 2 }],
    [["completed", "cancelled"], { status: "cancelled", completed: 1, total: 2 }],
  ])("derives %j judge executions into the reported state", async (states, expected) => {
    mocks.findJudgeExecutions.mockResolvedValue(runs(...states));
    const response = await GET(event());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
  });

  it("caches terminal progress once every judge execution has settled", async () => {
    mocks.findJudgeExecutions.mockResolvedValue(runs("completed", "cancelled"));
    await GET(event());
    expect(mocks.recordRejudgeProgress).toHaveBeenCalledWith(workflowId, {
      status: "cancelled",
      completed: 1,
      total: 2,
    });
  });

  it.each(["GET", "POST"])(
    "rejects non-owners with 403 for %s before reading judge executions",
    async (method) => {
      mocks.actor.userId = "other";
      const response = await (method === "GET" ? GET : POST)(event(method));
      expect(response.status).toBe(403);
      expect(mocks.findJudgeExecutions).not.toHaveBeenCalled();
    },
  );

  it("allows administrators to inspect another requester's rejudge", async () => {
    mocks.actor.userId = "admin";
    mocks.actor.platformRole = "admin";
    expect((await GET(event())).status).toBe(200);
  });

  it("returns 404 for unknown and non-rejudge identifiers", async () => {
    mocks.findByWorkflowId.mockResolvedValue(null);
    expect((await GET(event())).status).toBe(404);
    expect((await GET(event("GET", "judge-unrelated"))).status).toBe(404);
    expect((await GET(event("GET", `rejudge-${"x".repeat(256)}`))).status).toBe(404);
  });

  it("returns 503 on database failure without a success payload", async () => {
    mocks.findByWorkflowId.mockRejectedValue(new Error("backend connection refused"));
    const response = await GET(event());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining("retry"),
    });
  });

  it("reports invalid persisted ownership data as a server error without leaking it", async () => {
    mocks.findByWorkflowId.mockResolvedValue({
      ...work(),
      payload: { workflowId, input: { mode: "batch" } },
    });
    const response = await GET(event());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "Internal server error." });
    expect(mocks.logError).toHaveBeenCalledWith(
      "Request failed",
      expect.objectContaining({
        err: expect.objectContaining({ message: expect.stringContaining("triggeredByUserId") }),
      }),
    );
  });

  it("returns 404 for a legacy workflow without a cached terminal state", async () => {
    mocks.findByWorkflowId.mockResolvedValue(work({ prepared: false }));
    expect((await GET(event())).status).toBe(404);
    expect((await POST(event("POST"))).status).toBe(404);
  });

  it.each(["completed", "failed", "cancelled"])(
    "preserves a legacy workflow's cached %s state when cancellation is requested",
    async (status) => {
      mocks.findByWorkflowId.mockResolvedValue(
        work({ prepared: false, result: { status, completed: 2, total: 5 } }),
      );
      const response = await POST(event("POST"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status });
    },
  );
});

describe("rejudge discovery", () => {
  it("finds queued requester batches with an exact context match", async () => {
    const queued = work();
    mocks.listRejudgeCandidates.mockResolvedValue([
      queued,
      {
        ...queued,
        payload: {
          ...queued.payload,
          workflowId: "rejudge-exam",
          input: { ...queued.payload.input, examId: "exam" },
        },
      },
    ]);
    mocks.findByWorkflowId.mockResolvedValue(queued);
    mocks.findJudgeExecutions.mockResolvedValue(runs("queued"));
    expect(
      await submissionDomain.listActiveRejudges(
        mocks.actor as Parameters<typeof submissionDomain.listActiveRejudges>[0],
        { problemId: "p1", scope: {} },
      ),
    ).toEqual({ items: [{ workflowId, status: "queued", completed: 0, total: 1 }] });
    expect(mocks.listRejudgeCandidates).toHaveBeenCalledWith({
      problemId: "p1",
      requesterId: "owner",
    });
  });

  it("omits terminal batches and allows administrators to discover all requesters", async () => {
    mocks.listRejudgeCandidates.mockResolvedValue([work()]);
    mocks.findJudgeExecutions.mockResolvedValue(runs("completed", "completed"));
    expect(
      await submissionDomain.listActiveRejudges(
        { userId: "admin", platformRole: "admin" },
        { problemId: "p1", scope: {} },
      ),
    ).toEqual({ items: [] });
    expect(mocks.listRejudgeCandidates).toHaveBeenCalledWith({ problemId: "p1" });
  });

  it("enforces requester ownership even if discovery returns a forged candidate", async () => {
    mocks.listRejudgeCandidates.mockResolvedValue([work()]);
    mocks.findByWorkflowId.mockResolvedValue({
      ...work(),
      payload: {
        ...work().payload,
        input: { ...work().payload.input, triggeredByUserId: "other" },
      },
    });
    await expect(
      submissionDomain.listActiveRejudges(
        mocks.actor as Parameters<typeof submissionDomain.listActiveRejudges>[0],
        { problemId: "p1", scope: {} },
      ),
    ).rejects.toThrow("Only the rejudge requester");
  });
});
