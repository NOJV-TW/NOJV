import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxRequest } from "@nojv/core";
import { buildValidateConfigMapData } from "../../../apps/worker/src/services/k8s-configmaps";
import { resolveValidateCaseFiles } from "../../../apps/sandbox-runner/src/judges/validate";
import { mergeCheckerResults } from "../../../apps/worker/src/services/check-standard";
import { mapResult } from "../../../packages/application/src/submission/scoring";

import {
  writeValidatorFiles,
  runValidator,
  type ValidatorRunParams,
} from "../../../apps/worker/src/services/validator-executor";

const { spawnDockerContainer } = vi.hoisted(() => ({ spawnDockerContainer: vi.fn() }));
vi.mock("../../../apps/worker/src/services/docker-process", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../apps/worker/src/services/docker-process")
  >()),
  spawnDockerContainer,
}));

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe("writeValidatorFiles", () => {
  let tempDir: string;

  const params: ValidatorRunParams = {
    runId: "run-1",
    submissionId: "sub-1",
    validatorScript: "accept()\n",
    validatorLanguage: "python",
    cases: [
      { index: 0, input: "1\n", answer: "ans0\n", teamOutput: "team0\n" },
      { index: 1, input: "2\n", answer: "ans1\n", teamOutput: "team1\n" },
    ],
    limits: { timeoutMs: 1_000, memoryMb: 256 },
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "nojv-validate-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it.each([
    [
      "duplicate",
      [
        { index: 0, verdict: "WA" },
        { index: 0, verdict: "AC" },
        { index: 1, verdict: "AC" },
      ],
    ],
    ["missing", [{ index: 0, verdict: "AC" }]],
    [
      "unexpected",
      [
        { index: 0, verdict: "AC" },
        { index: 2, verdict: "AC" },
      ],
    ],
  ])(
    "rejects %s validator case indices before mapping the final verdict",
    async (_name, validatorOutcomes) => {
      spawnDockerContainer.mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify({ validatorOutcomes }),
        stderr: "",
        timedOut: false,
        spawnError: null,
      });
      const outcomes = await runValidator(tempDir, params, new AbortController().signal, {
        cpuLimit: "1",
        image: "test",
        memoryMb: 256,
        pidsLimit: 64,
      });
      const testcaseResults = mergeCheckerResults(
        params.cases.map(({ index, teamOutput }) => ({
          index,
          stdout: teamOutput,
          stderr: "",
          exitCode: 0,
          timeMs: 1,
        })),
        outcomes,
      );
      expect(
        mapResult(
          { testcaseResults },
          [],
          { adjustment: { assignmentAdjustmentRules: null } } as never,
          2,
        ),
      ).toMatchObject({ accepted: false, verdict: "system_error" });
      expect(testcaseResults[0]?.staffFeedback).toContain(
        "expected testcase indices exactly once",
      );
    },
  );

  it("accepts unordered outcomes for the exact sparse set of cases sent to the validator", async () => {
    spawnDockerContainer.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        validatorOutcomes: [
          { index: 2, verdict: "WA" },
          { index: 0, verdict: "AC" },
        ],
      }),
      stderr: "",
      timedOut: false,
      spawnError: null,
    });
    const outcomes = await runValidator(
      tempDir,
      { ...params, cases: [params.cases[0]!, { ...params.cases[1]!, index: 2 }] },
      new AbortController().signal,
      { cpuLimit: "1", image: "test", memoryMb: 256, pidsLimit: 64 },
    );
    expect(outcomes.get(0)).toEqual({ verdict: "AC" });
    expect(outcomes.get(2)).toEqual({ verdict: "WA" });
  });

  it.each([
    [{ spawnError: "docker unavailable" }, "docker unavailable"],
    [{ timedOut: true }, "timed out"],
    [{ exitCode: 1, stderr: "container failure" }, "container failure"],
    [{ stdout: "invalid json" }, "Invalid validator JSON"],
    [
      { stdout: JSON.stringify({ validatorOutcomes: [{ index: 0, verdict: "bogus" }] }) },
      "verdict",
    ],
    [
      { stdout: JSON.stringify({ compilationError: "C++ compiler failure" }) },
      "C++ compiler failure",
    ],
  ])("preserves validator infrastructure diagnostics (%s)", async (overrides, message) => {
    spawnDockerContainer.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      sizeExceeded: false,
      spawnError: null,
      ...overrides,
    });
    const outcomes = await runValidator(tempDir, params, new AbortController().signal, {
      cpuLimit: "1",
      image: "test",
      memoryMb: 256,
      pidsLimit: 64,
    });
    expect(outcomes.get(0)).toMatchObject({
      verdict: "SE",
      judgeMessage: expect.stringContaining(message),
    });
  });

  it("writes the validator source with the language extension", async () => {
    await writeValidatorFiles(tempDir, params);
    expect(await exists(join(tempDir, "validator.py"))).toBe(true);
    expect(await readFile(join(tempDir, "validator.py"), "utf8")).toBe("accept()\n");
  });

  it("writes a config.json carrying the validate block + case indices", async () => {
    await writeValidatorFiles(tempDir, params);
    const config = JSON.parse(await readFile(join(tempDir, "config.json"), "utf8"));
    expect(config.validate).toEqual({
      language: "python",
      cases: [{ index: 0 }, { index: 1 }],
    });
  });

  it("writes per-case input/answer/team files using the shared flat layout", async () => {
    await writeValidatorFiles(tempDir, params);
    expect(await readFile(join(tempDir, "case-0-input.txt"), "utf8")).toBe("1\n");
    expect(await readFile(join(tempDir, "case-0-answer.txt"), "utf8")).toBe("ans0\n");
    expect(await readFile(join(tempDir, "case-0-team.txt"), "utf8")).toBe("team0\n");
    expect(await readFile(join(tempDir, "case-1-team.txt"), "utf8")).toBe("team1\n");
  });

  it("Docker and K8s validation payloads share the runner contract", async () => {
    const request: SandboxRequest = {
      submissionId: params.submissionId,
      sourceCode: "",
      language: "python",
      problemType: "full_source",
      judgeType: "checker",
      judgeConfig: {
        checkerScript: params.validatorScript,
        checkerLanguage: params.validatorLanguage,
      },
      limits: params.limits,
      testcases: params.cases.map((c) => ({
        index: c.index,
        input: c.input,
        output: c.answer,
        weight: 1,
        isSample: false,
      })),
    };
    const rawRuns = params.cases.map((c) => ({
      index: c.index,
      stdout: c.teamOutput,
      stderr: "",
      exitCode: 0,
      timeMs: 1,
    }));
    const k8sData = buildValidateConfigMapData(request, rawRuns);
    await writeValidatorFiles(tempDir, params);
    for (const [key, value] of Object.entries(k8sData)) {
      const dockerValue = await readFile(join(tempDir, key), "utf8");
      if (key === "config.json") expect(JSON.parse(dockerValue)).toEqual(JSON.parse(value));
      else expect(dockerValue).toBe(value);
    }
    expect((await resolveValidateCaseFiles(tempDir, 1)).teamOutput).toBe(
      params.cases[1]!.teamOutput,
    );
  });

  it("uses the cpp extension for cpp validators", async () => {
    await writeValidatorFiles(tempDir, { ...params, validatorLanguage: "cpp" });
    expect(await exists(join(tempDir, "validator.cpp"))).toBe(true);
  });
});
