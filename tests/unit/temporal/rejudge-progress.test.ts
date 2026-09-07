import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowNotFoundError } from "@temporalio/client";

const { describeWorkflow, query, withDeadline } = vi.hoisted(() => ({
  describeWorkflow: vi.fn(),
  query: vi.fn(),
  withDeadline: vi.fn(),
}));
vi.mock("../../../packages/temporal/src/client", () => ({
  getTemporalClient: async () => ({
    connection: { withDeadline },
    workflow: { getHandle: () => ({ describe: describeWorkflow, query }) },
  }),
}));
import { queryRejudgeProgress } from "../../../packages/temporal/src/dispatch";

beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue({ completed: 2, total: 5 });
  withDeadline.mockImplementation((_deadline, fn) => fn());
});

describe("Temporal rejudge state", () => {
  it.each([
    ["RUNNING", "running"],
    ["COMPLETED", "completed"],
    ["FAILED", "failed"],
    ["CANCELLED", "cancelled"],
    ["TIMED_OUT", "failed"],
    ["TERMINATED", "failed"],
  ])(
    "maps %s to %s and retains queryable progress on closed workflows",
    async (temporal, status) => {
      describeWorkflow.mockResolvedValue({ status: { name: temporal } });
      expect(await queryRejudgeProgress("rejudge-test")).toEqual({
        status,
        completed: 2,
        total: 5,
      });
      expect(query).toHaveBeenCalledWith("getProgress");
      expect(withDeadline).toHaveBeenCalledWith(expect.any(Number), expect.any(Function));
    },
  );
  it("distinguishes absent workflow from unavailable service", async () => {
    describeWorkflow.mockRejectedValue(new WorkflowNotFoundError("missing", "rejudge-test"));
    await expect(queryRejudgeProgress("rejudge-test")).resolves.toBeNull();
    describeWorkflow.mockRejectedValue(new Error("connection refused"));
    await expect(queryRejudgeProgress("rejudge-test")).rejects.toThrow("connection refused");
  });
  it("does not turn a failed progress query into completion", async () => {
    describeWorkflow.mockResolvedValue({ status: { name: "RUNNING" } });
    query.mockRejectedValue(new Error("query unavailable"));
    await expect(queryRejudgeProgress("rejudge-test")).rejects.toThrow("query unavailable");
  });
});
