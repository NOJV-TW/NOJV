import { describe, expect, it } from "vitest";

import type { SandboxRequest } from "@nojv/core";

import { buildSandboxConfigJson } from "../../../apps/worker/src/services/sandbox-plan";
import { SandboxInputSchema } from "../../../apps/sandbox-runner/src/types";

function baseRequest(overrides: Partial<SandboxRequest> = {}): SandboxRequest {
  return {
    submissionId: "sub_1",
    sourceCode: "print(1)",
    language: "python",
    problemType: "full_source",
    judgeType: "standard",
    judgeConfig: {},
    testcases: [],
    limits: { timeoutMs: 1000, memoryMb: 256 },
    ...overrides,
  };
}

type SourceFileMap = { path: string; key: string }[];

const cases: { name: string; request: SandboxRequest; sourceFileMap: SourceFileMap }[] = [
  { name: "standard / full_source", request: baseRequest(), sourceFileMap: [] },
  {
    name: "checker / full_source",
    request: baseRequest({ judgeType: "checker", judgeConfig: { checkerLanguage: "cpp" } }),
    sourceFileMap: [],
  },
  {
    name: "interactive / full_source",
    request: baseRequest({
      judgeType: "interactive",
      judgeConfig: { interactorLanguage: "cpp" },
    }),
    sourceFileMap: [],
  },
  {
    name: "multi_file with entryFile + sourceFileMap",
    request: baseRequest({ problemType: "multi_file", entryFile: "main.py" }),
    sourceFileMap: [
      { path: "main.py", key: "s3/main.py" },
      { path: "lib.py", key: "s3/lib.py" },
    ],
  },
  {
    name: "special_env",
    request: baseRequest({ problemType: "special_env" }),
    sourceFileMap: [],
  },
];

describe("sandbox cross-process contract — buildSandboxConfigJson ⊨ SandboxInputSchema", () => {
  for (const c of cases) {
    it(`${c.name}: worker config parses as runner SandboxInput`, () => {
      const config = buildSandboxConfigJson(c.request, c.sourceFileMap);
      const parsed = SandboxInputSchema.safeParse(config);
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(
        true,
      );
    });
  }

  it("preserves every field the worker emits (a producer→schema rename would drop it)", () => {
    const request = baseRequest({
      judgeType: "checker",
      problemType: "multi_file",
      entryFile: "main.py",
      judgeConfig: { checkerLanguage: "cpp", interactorLanguage: "python" },
    });
    const sourceFileMap: SourceFileMap = [{ path: "main.py", key: "s3/main.py" }];
    const config = buildSandboxConfigJson(request, sourceFileMap);
    const parsed = SandboxInputSchema.parse(config);

    for (const key of Object.keys(config)) {
      expect(parsed, `runner schema dropped worker field "${key}"`).toHaveProperty(key);
    }
    expect(parsed.sourceFileMap).toEqual(sourceFileMap);
    expect(parsed.entryFile).toBe("main.py");
    expect(parsed.checkerLanguage).toBe("cpp");
    expect(parsed.interactorLanguage).toBe("python");
  });
});
