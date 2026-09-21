import { ApplicationFailure, TimeoutFailure } from "@temporalio/client";
import { describe, expect, it } from "vitest";

import { isNonRetryableJudgeFailure } from "../../../apps/worker/src/workflows/submission-judge";

import { executorTimeout } from "../../../apps/worker/src/workflows/judge-executor-recovery";

describe("judge attempt retry classification", () => {
  it("recognizes a Temporal ApplicationFailure type through nested activity failures", () => {
    const cause = ApplicationFailure.create({
      message: "Requested memory exceeds the sandbox limit",
      type: "SandboxAdmissionError",
    });
    expect(
      isNonRetryableJudgeFailure(
        new Error("Activity failed", { cause: new Error("Wrapper", { cause }) }),
      ),
    ).toBe(true);
  });

  it("stops explicit non-retryable failures and impossible capacity requests", () => {
    expect(
      isNonRetryableJudgeFailure(
        ApplicationFailure.nonRetryable("Invalid config", "ConfigError"),
      ),
    ).toBe(true);
    expect(isNonRetryableJudgeFailure(new Error("resource_request_unsatisfiable"))).toBe(true);
    const direct = new Error("Invalid sandbox resources");
    direct.name = "SandboxAdmissionError";
    expect(isNonRetryableJudgeFailure(direct)).toBe(true);
  });

  it("retries artifact loss and transient infrastructure failures with a new attempt", () => {
    expect(isNonRetryableJudgeFailure(new Error("artifact_node_unavailable"))).toBe(false);
    expect(
      isNonRetryableJudgeFailure(
        ApplicationFailure.create({
          message: "API temporarily unavailable",
          type: "SandboxInfrastructureError",
        }),
      ),
    ).toBe(false);
    expect(
      isNonRetryableJudgeFailure(
        new Error("API error mentioned SandboxAdmissionError in a log"),
      ),
    ).toBe(false);
  });

  it("handles unknown and cyclic causes without hanging", () => {
    const cyclic = new Error("Transient failure");
    cyclic.cause = cyclic;
    expect(isNonRetryableJudgeFailure(cyclic)).toBe(false);
    expect(isNonRetryableJudgeFailure(null)).toBe(false);
  });
});

describe("judge producer timeout classification", () => {
  it.each(["HEARTBEAT", "START_TO_CLOSE", "SCHEDULE_TO_CLOSE"] as const)(
    "requires producer-stop verification for %s",
    (timeoutType) => {
      const error = new Error("Activity failed", {
        cause: new TimeoutFailure("Timed out", undefined, timeoutType),
      });
      expect(executorTimeout(error)).toEqual({ timeoutType });
    },
  );
  it("does not wait for an activity that never started or an ordinary failure", () => {
    expect(
      executorTimeout(new TimeoutFailure("Queue timeout", undefined, "SCHEDULE_TO_START")),
    ).toBeNull();
    expect(executorTimeout(new Error("Infrastructure failure"))).toBeNull();
    const cyclic = new Error("Cyclic");
    cyclic.cause = cyclic;
    expect(executorTimeout(cyclic)).toBeNull();
  });
});
