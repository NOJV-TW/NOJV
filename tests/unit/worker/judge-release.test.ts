import { describe, expect, it } from "vitest";
import { defaultPayloadConverter } from "@temporalio/client";
import {
  rollbackStateBlockers,
  isBaselineJudgeInput,
  type JudgeReleaseState,
} from "../../../scripts/judge-release";

const ready = (): JudgeReleaseState => ({
  paused: false,
  quotaReady: true,
  dispatchRoute: "legacy",
  draining: true,
  routingInFlight: 0,
  activeSubmissionIds: [],
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
    { admission: { permits: [{ cleanupConfirmed: false }], pending: [] } },
    { admission: { permits: [], pending: [{}] } },
  ])("fails closed for %j", (patch) => {
    expect(rollbackStateBlockers({ ...ready(), ...patch }).length).toBeGreaterThan(0);
  });
});

describe("rollback durable input boundary", () => {
  const payload = (value: unknown) => defaultPayloadConverter.toPayload(value)!;
  it("accepts only a fresh canonical execution reference", () => {
    expect(
      isBaselineJudgeInput(
        [payload({ executionId: "execution" })],
        "judge-execution-execution-0",
      ),
    ).toBe(true);
  });
  it.each([
    [{ executionId: "execution", capacity: true }],
    [{ executionId: "execution" }, { runId: "retained-state" }],
    [{ executionId: "other" }],
    [{ submissionId: "execution" }],
    [],
  ])("rejects incompatible or unknown input %j", (...values) => {
    expect(isBaselineJudgeInput(values.map(payload), "judge-execution-execution-0")).toBe(
      false,
    );
  });
});
