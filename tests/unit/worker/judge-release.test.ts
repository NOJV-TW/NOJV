import { describe, expect, it } from "vitest";
import { rollbackStateBlockers, type JudgeReleaseState } from "../../../scripts/judge-release";

const ready = (): JudgeReleaseState => ({
  paused: false,
  quotaReady: true,
  dispatchRoute: "legacy",
  draining: true,
  routingInFlight: 0,
  activeSubmissionIds: [],
  activeRejudgeIds: [],
  stagedWorkflowIds: [],
  admission: { permits: [], pending: [] },
});

describe("rollback readiness", () => {
  it("accepts only drained legacy routing", () => {
    expect(rollbackStateBlockers(ready())).toEqual([]);
  });
  it("rejects a missing workflow ledger", () => {
    const state = ready();
    delete state.stagedWorkflowIds;
    expect(rollbackStateBlockers(state).length).toBeGreaterThan(0);
  });
  it.each([
    { dispatchRoute: "capacity" as const },
    { dispatchRoute: "hold" as const },
    { draining: false },
    { routingInFlight: 1 },
    { activeSubmissionIds: ["submission"] },
    { activeRejudgeIds: ["batch"] },
    { admission: { permits: [{ cleanupConfirmed: false }], pending: [] } },
    { admission: { permits: [], pending: [{}] } },
  ])("fails closed for %j", (patch) => {
    expect(rollbackStateBlockers({ ...ready(), ...patch }).length).toBeGreaterThan(0);
  });
});
