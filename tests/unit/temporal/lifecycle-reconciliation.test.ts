import { describe, expect, it } from "vitest";

import {
  decideLifecycleReconciliation,
  type ObservedLifecycleRun,
} from "../../../packages/temporal/src/lifecycle-reconciliation";

const desired = {
  scheduleRevision: 4,
  timerFingerprint: "exam:v1:exam_1:1000:window_b",
};

function observed(overrides: Partial<ObservedLifecycleRun> = {}): ObservedLifecycleRun {
  return {
    runId: "run_1",
    scheduleRevision: 4,
    status: "RUNNING",
    timerFingerprint: desired.timerFingerprint,
    ...overrides,
  };
}

describe("decideLifecycleReconciliation", () => {
  it("starts an absent desired lifecycle", () => {
    expect(decideLifecycleReconciliation("ensure", desired, null)).toBe("start");
  });

  it.each(["RUNNING", "COMPLETED"] as const)(
    "does not restart an already-satisfied %s occurrence",
    (status) => {
      expect(decideLifecycleReconciliation("ensure", desired, observed({ status }))).toBe(
        "keep",
      );
    },
  );

  it("restarts a failed run for the desired occurrence", () => {
    expect(
      decideLifecycleReconciliation("ensure", desired, observed({ status: "FAILED" })),
    ).toBe("start");
  });

  it("replaces a running older occurrence", () => {
    expect(
      decideLifecycleReconciliation(
        "replace",
        desired,
        observed({
          scheduleRevision: 3,
          timerFingerprint: "exam:v1:exam_1:1000:window_a",
        }),
      ),
    ).toBe("terminate-and-start");
  });

  it("starts after an older terminal occurrence", () => {
    expect(
      decideLifecycleReconciliation(
        "ensure",
        desired,
        observed({
          scheduleRevision: 3,
          status: "COMPLETED",
          timerFingerprint: "exam:v1:exam_1:1000:window_a",
        }),
      ),
    ).toBe("start");
  });

  it("keeps an older revision when its fingerprint already satisfies the occurrence", () => {
    expect(
      decideLifecycleReconciliation(
        "ensure",
        desired,
        observed({ scheduleRevision: 3, status: "COMPLETED" }),
      ),
    ).toBe("keep");
  });

  it("never downgrades a newer observed revision", () => {
    expect(
      decideLifecycleReconciliation(
        "replace",
        desired,
        observed({ scheduleRevision: 5, timerFingerprint: "exam:v1:exam_1:1000:window_c" }),
      ),
    ).toBe("keep");
  });

  it("never lets an older incarnation replace a recreated entity at the same revision", () => {
    expect(
      decideLifecycleReconciliation(
        "replace",
        desired,
        observed({ timerFingerprint: "exam:v1:exam_1:2000:window_a" }),
      ),
    ).toBe("keep");
  });

  it("replaces an older incarnation even when its revision was higher before recreation", () => {
    expect(
      decideLifecycleReconciliation(
        "ensure",
        { scheduleRevision: 1, timerFingerprint: "exam:v1:exam_1:2000:window_a" },
        observed({
          scheduleRevision: 9,
          timerFingerprint: "exam:v1:exam_1:1000:window_b",
        }),
      ),
    ).toBe("terminate-and-start");
  });

  it("cancels only a matching running occurrence at or below the cancellation revision", () => {
    expect(decideLifecycleReconciliation("cancel", desired, observed())).toBe("terminate");
    expect(
      decideLifecycleReconciliation(
        "cancel",
        desired,
        observed({
          scheduleRevision: 3,
          timerFingerprint: "exam:v1:exam_1:1000:window_a",
        }),
      ),
    ).toBe("terminate");
  });

  it("does not let a stale cancellation terminate a newer or reincarnated run", () => {
    expect(
      decideLifecycleReconciliation("cancel", desired, observed({ scheduleRevision: 5 })),
    ).toBe("keep");
    expect(
      decideLifecycleReconciliation(
        "cancel",
        desired,
        observed({ timerFingerprint: "exam:v1:exam_1:2000:window_a" }),
      ),
    ).toBe("keep");
  });

  it("lets a newer incarnation cancel an orphaned older run", () => {
    expect(
      decideLifecycleReconciliation(
        "cancel",
        { scheduleRevision: 1, timerFingerprint: "exam:v1:exam_1:2000:window_a" },
        observed({
          scheduleRevision: 9,
          timerFingerprint: "exam:v1:exam_1:1000:window_b",
        }),
      ),
    ).toBe("terminate");
  });

  it("treats terminal cancellation targets as already stopped", () => {
    expect(
      decideLifecycleReconciliation("cancel", desired, observed({ status: "FAILED" })),
    ).toBe("keep");
  });
});
