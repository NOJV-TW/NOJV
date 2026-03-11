import { describe, expect, it } from "vitest";

import { evaluateIntegritySignals } from "@nojv/core";

describe("evaluateIntegritySignals", () => {
  it("escalates combined contest telemetry into a high-risk case", () => {
    const result = evaluateIntegritySignals([
      {
        capturedAt: "2026-03-08T08:30:00.000Z",
        confidence: 0.82,
        contestSlug: "spring-qualifier-2026",
        payload: {
          blurCount: 4
        },
        sessionId: "ws_contest_demo_01",
        source: "problem_editor",
        type: "focus_loss",
        userId: "usr_1048"
      },
      {
        capturedAt: "2026-03-08T08:31:00.000Z",
        confidence: 0.94,
        contestSlug: "spring-qualifier-2026",
        payload: {
          forbiddenCommand: "bash"
        },
        sessionId: "ws_contest_demo_01",
        source: "contest_workspace",
        type: "shell_policy_violation",
        userId: "usr_1048"
      },
      {
        capturedAt: "2026-03-08T08:32:00.000Z",
        confidence: 0.79,
        contestSlug: "spring-qualifier-2026",
        payload: {
          pastedCharacters: 320
        },
        sessionId: "ws_contest_demo_01",
        source: "problem_editor",
        type: "paste_burst",
        userId: "usr_1048"
      }
    ]);

    expect(result.level).toBe("high");
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.reasons).toContain(
      "Contest shell policy violations sharply raise reviewer priority."
    );
  });

  it("keeps low-confidence background noise in the review queue instead of auto-escalating", () => {
    const result = evaluateIntegritySignals([
      {
        capturedAt: "2026-03-08T08:30:00.000Z",
        confidence: 0.22,
        payload: {
          blurCount: 1
        },
        sessionId: "ws_practice_demo_01",
        source: "problem_editor",
        type: "focus_loss",
        userId: "usr_3191"
      }
    ]);

    expect(result.level).toBe("low");
    expect(result.score).toBeLessThan(35);
  });
});
