import { describe, expect, it } from "vitest";

import { resolveScoringDispatch } from "../../../apps/worker/src/workflows/submission-judge-helpers";

describe("resolveScoringDispatch — judge workflow scoring-path selection", () => {
  it("routes a contest submission to the contest path", () => {
    expect(
      resolveScoringDispatch({
        contestId: "c_1",
        examId: null,
        userId: "u_1",
      }),
    ).toEqual({ kind: "contest", contestId: "c_1", userId: "u_1" });
  });

  it("routes an exam submission to the exam path (the branch PR #83 dropped)", () => {
    expect(
      resolveScoringDispatch({
        contestId: null,
        examId: "ex_1",
        userId: "u_1",
      }),
    ).toEqual({ kind: "exam", examId: "ex_1", userId: "u_1" });
  });

  it("treats a practice submission (no context) as no scoring dispatch", () => {
    expect(
      resolveScoringDispatch({
        contestId: null,
        examId: null,
        userId: "u_1",
      }),
    ).toEqual({ kind: "none" });
  });

  it("prefers the contest path when both context FKs are set (XOR is enforced upstream)", () => {
    expect(
      resolveScoringDispatch({
        contestId: "c_1",
        examId: "ex_1",
        userId: "u_1",
      }),
    ).toEqual({ kind: "contest", contestId: "c_1", userId: "u_1" });
  });
});
