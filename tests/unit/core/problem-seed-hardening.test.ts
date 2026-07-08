import { describe, expect, it } from "vitest";

import { validateProblemDefinitions } from "../../../packages/db/prisma/seeds/problems";

describe("problem seed hardening", () => {
  it("rejects interactive problems without interactor scripts", () => {
    expect(() =>
      validateProblemDefinitions([
        {
          authorId: "teacher",
          type: "full_source",
          title: "Broken Interactive",
          id: "problem_broken-interactive",
          memoryLimitMb: 256,
          timeLimitMs: 1000,
          visibility: "public",
          judgeConfig: { type: "interactive" },
          statement: {
            body: "壞題",
          },
          testcases: {
            sample: {
              cases: [{ input: "1", output: "" }],
            },
            hidden: {
              cases: [{ input: "2", output: "" }],
            },
          },
        },
      ]),
    ).toThrow(/Interactive judge requires interactorScript/);
  });

  it("rejects checker problems without checker scripts", () => {
    expect(() =>
      validateProblemDefinitions([
        {
          authorId: "teacher",
          type: "full_source",
          title: "Broken Checker",
          id: "problem_broken-checker",
          memoryLimitMb: 256,
          timeLimitMs: 1000,
          visibility: "public",
          judgeConfig: { type: "checker" },
          statement: {
            body: "壞題",
          },
          testcases: {
            sample: {
              cases: [{ input: "1", output: "" }],
            },
            hidden: {
              cases: [{ input: "2", output: "" }],
            },
          },
        },
      ]),
    ).toThrow(/Checker judge requires checkerScript/);
  });
});
