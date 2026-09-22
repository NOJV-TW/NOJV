import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  domainTurn: vi.fn(),
  getTemporalClient: vi.fn(),
  getHandle: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@nojv/application", () => ({
  submissionDomain: { judgeExecutionTurn: mocks.domainTurn },
}));
vi.mock("@nojv/temporal", () => ({ getTemporalClient: mocks.getTemporalClient }));
vi.mock("@nojv/redis", () => ({ getRedis: vi.fn() }));
vi.mock("../../../apps/worker/src/services/k8s-executor", () => ({
  K8sExecutor: vi.fn(),
  resolveK8sMemoryLimit: vi.fn(),
}));

import { judgeExecutionTurn } from "../../../apps/worker/src/activities/judge-stages";

const executionId = "execution-under-review";
const workflowId = "judge-execution-under-review-0";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getTemporalClient.mockResolvedValue({ workflow: { getHandle: mocks.getHandle } });
  mocks.getHandle.mockReturnValue({ query: mocks.query });
});

describe("judge execution FIFO turn and narrow dispatch query", () => {
  it("returns obsolete without contacting Temporal", async () => {
    mocks.domainTurn.mockResolvedValue("obsolete");

    await expect(judgeExecutionTurn(executionId, workflowId)).resolves.toBe("obsolete");

    expect(mocks.domainTurn).toHaveBeenCalledWith(executionId, workflowId);
    expect(mocks.getTemporalClient).not.toHaveBeenCalled();
  });

  it.each([
    { dispatchRoute: "capacity", draining: false, active: false },
    { dispatchRoute: "capacity", draining: true, active: false },
    { dispatchRoute: "legacy", draining: false, active: false },
    { dispatchRoute: "legacy", draining: true, active: true },
  ])("preserves the domain FIFO decision under %j", async (state) => {
    mocks.query.mockResolvedValue(state);

    for (const turn of ["ready", "wait"] as const) {
      mocks.domainTurn.mockResolvedValue(turn);
      await expect(judgeExecutionTurn(executionId, workflowId)).resolves.toBe(turn);
    }

    expect(mocks.getHandle).toHaveBeenCalledWith("judge-admission-v1");
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query).toHaveBeenNthCalledWith(1, "judgeDispatchState", executionId);
    expect(mocks.query).toHaveBeenNthCalledWith(2, "judgeDispatchState", executionId);
  });

  it.each(["ready", "wait"])(
    "redirects untouched %s work when draining to legacy",
    async (turn) => {
      mocks.domainTurn.mockResolvedValue(turn);
      mocks.query.mockResolvedValue({ dispatchRoute: "legacy", draining: true, active: false });

      await expect(judgeExecutionTurn(executionId, workflowId)).resolves.toBe("redirect");
      expect(mocks.query).toHaveBeenCalledWith("judgeDispatchState", executionId);
    },
  );

  it("propagates query failure instead of granting an unverified FIFO turn", async () => {
    const failure = new Error("Coordinator unavailable");
    mocks.domainTurn.mockResolvedValue("ready");
    mocks.query.mockRejectedValue(failure);

    await expect(judgeExecutionTurn(executionId, workflowId)).rejects.toBe(failure);
  });

  it("propagates a domain failure before any coordinator query", async () => {
    const failure = new Error("Execution lookup failed");
    mocks.domainTurn.mockRejectedValue(failure);

    await expect(judgeExecutionTurn(executionId, workflowId)).rejects.toBe(failure);
    expect(mocks.getTemporalClient).not.toHaveBeenCalled();
  });
});
