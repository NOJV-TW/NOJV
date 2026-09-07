import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findByWorkflowId: vi.fn(),
  cancelUnattempted: vi.fn(),
  queryProgress: vi.fn(),
  cancelWorkflow: vi.fn(),
  logError: vi.fn(),
  actor: { userId: "owner", platformRole: "teacher" },
}));

vi.mock("$lib/server/logger", () => ({ createLogger: () => ({ error: mocks.logError }) }));

vi.mock("@nojv/db", () => ({
  durableWorkRepo: {
    findByWorkflowId: mocks.findByWorkflowId,
    cancelUnattempted: mocks.cancelUnattempted,
  },
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

import { configureDomainOrchestration } from "@nojv/application";
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
function work(status = "succeeded", attempt = 1) {
  return {
    status,
    attempt,
    dedupeKey: workflowId,
    payload: {
      workflowId,
      input: { mode: "batch", problemId: "p1", triggeredByUserId: "owner" },
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.userId = "owner";
  mocks.actor.platformRole = "teacher";
  mocks.findByWorkflowId.mockResolvedValue(work());
  mocks.queryProgress.mockResolvedValue({ status: "running", completed: 0, total: 0 });
  configureDomainOrchestration({
    queryRejudgeProgress: mocks.queryProgress,
    cancelRejudge: mocks.cancelWorkflow,
  } as unknown as Parameters<typeof configureDomainOrchestration>[0]);
});

describe("rejudge state routes", () => {
  it("reads queued ownership before Temporal has accepted the dispatch", async () => {
    mocks.findByWorkflowId.mockResolvedValue(work("pending", 0));
    const response = await GET(event());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "queued", completed: 0, total: 0 });
    expect(mocks.queryProgress).not.toHaveBeenCalled();
  });

  it("keeps leased dispatch queued when the workflow does not exist yet", async () => {
    mocks.findByWorkflowId.mockResolvedValue(work("leased"));
    mocks.queryProgress.mockResolvedValue(null);
    expect(await (await GET(event())).json()).toEqual({
      status: "queued",
      completed: 0,
      total: 0,
    });
  });

  it.each(["running", "completed", "failed", "cancelled"])(
    "reports the actual %s state",
    async (status) => {
      mocks.queryProgress.mockResolvedValue({ status, completed: 0, total: 0 });
      const response = await GET(event());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status, completed: 0, total: 0 });
    },
  );

  it("reports exhausted dispatch as failed, never completed", async () => {
    mocks.findByWorkflowId.mockResolvedValue(work("dead", 20));
    mocks.queryProgress.mockResolvedValue(null);
    expect(await (await GET(event())).json()).toEqual({
      status: "failed",
      completed: 0,
      total: 0,
    });
  });

  it.each(["GET", "POST"])(
    "rejects non-owners with 403 for %s before consulting Temporal",
    async (method) => {
      mocks.actor.userId = "other";
      const response = await (method === "GET" ? GET : POST)(event(method));
      expect(response.status).toBe(403);
      expect(mocks.queryProgress).not.toHaveBeenCalled();
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

  it.each(["database", "temporal"])(
    "returns 503 on %s failure without a success payload",
    async (backend) => {
      (backend === "database" ? mocks.findByWorkflowId : mocks.queryProgress).mockRejectedValue(
        new Error("backend connection refused"),
      );
      const response = await GET(event());
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        message: expect.stringContaining("retry"),
      });
    },
  );

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

  it("returns 404 for a dispatched workflow whose history is no longer available", async () => {
    mocks.queryProgress.mockResolvedValue(null);
    expect((await GET(event())).status).toBe(404);
    expect((await POST(event("POST"))).status).toBe(404);
  });

  it.each(["completed", "failed", "cancelled"])(
    "preserves an already %s state when cancellation is requested",
    async (status) => {
      mocks.queryProgress.mockResolvedValue({ status, completed: 2, total: 5 });
      const response = await POST(event("POST"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status });
      expect(mocks.cancelWorkflow).not.toHaveBeenCalled();
    },
  );

  it("atomically cancels only a dispatch that has never been attempted", async () => {
    mocks.findByWorkflowId.mockResolvedValue(work("pending", 0));
    mocks.cancelUnattempted.mockResolvedValue(true);
    const response = await POST(event("POST"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "cancelled" });
    expect(mocks.cancelWorkflow).not.toHaveBeenCalled();
  });

  it("does not confirm cancellation when dispatch wins the queued cancellation race", async () => {
    mocks.findByWorkflowId.mockResolvedValue(work("pending", 0));
    mocks.cancelUnattempted.mockResolvedValue(false);
    mocks.queryProgress.mockResolvedValue(null);
    const response = await POST(event("POST"));
    expect(response.status).toBe(503);
    expect(mocks.cancelWorkflow).not.toHaveBeenCalled();
  });

  it("acknowledges a running cancellation request without confirming a terminal state", async () => {
    const response = await POST(event("POST"));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "requested" });
    expect(mocks.cancelWorkflow).toHaveBeenCalledWith(workflowId);
  });
});
