import { describe, expect, it } from "vitest";

import {
  buildCheatingCaseSummary,
  mapIntegrityAssessmentToCaseStatus,
  mapSubmissionResultToStatus,
  mapWorkspaceRunResultToStatus
} from "../src/lib/server/persistence-mappers";

describe("mapSubmissionResultToStatus", () => {
  it("maps accepted verdicts to the accepted submission status", () => {
    expect(
      mapSubmissionResultToStatus({
        accepted: true,
        feedback: "ok",
        runtimeMs: 12,
        score: 100,
        verdict: "accepted"
      })
    ).toBe("accepted");
  });

  it("maps wrong answers to the matching submission status", () => {
    expect(
      mapSubmissionResultToStatus({
        accepted: false,
        feedback: "nope",
        runtimeMs: 12,
        score: 0,
        verdict: "wrong_answer"
      })
    ).toBe("wrong_answer");
  });
});

describe("mapWorkspaceRunResultToStatus", () => {
  it("keeps successful workspace runs as succeeded", () => {
    expect(
      mapWorkspaceRunResultToStatus({
        durationMs: 55,
        exitCode: 0,
        stderr: "",
        status: "succeeded",
        stdout: "ok"
      })
    ).toBe("succeeded");
  });

  it("keeps timed out runs explicit once Prisma supports the timeout enum", () => {
    expect(
      mapWorkspaceRunResultToStatus({
        durationMs: 5_000,
        exitCode: null,
        stderr: "Execution timed out.",
        status: "timed_out",
        stdout: ""
      })
    ).toBe("timed_out");
  });
});

describe("integrity case mapping", () => {
  it("marks high-risk assessments as open cases", () => {
    expect(
      mapIntegrityAssessmentToCaseStatus({
        level: "high",
        reasons: ["Contest shell policy violations sharply raise reviewer priority."],
        recommendedAction: "escalate",
        score: 88
      })
    ).toBe("open");
  });

  it("builds a compact reviewer summary from score and top evidence", () => {
    expect(
      buildCheatingCaseSummary(
        {
          level: "medium",
          reasons: [
            "Contest telemetry uses stricter thresholds than practice mode.",
            "Large paste bursts are unusual during supervised solving."
          ],
          recommendedAction: "review",
          score: 54
        },
        2
      )
    ).toContain("score=54");
  });
});
