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
          statements: {
            "zh-TW": { title: "壞題", body: "壞題" },
            en: { title: "Broken", body: "Broken" },
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
          statements: {
            "zh-TW": { title: "壞題", body: "壞題" },
            en: { title: "Broken", body: "Broken" },
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
