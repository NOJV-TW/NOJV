import {
  resolveContainerMemoryMb,
  type RawCaseRun,
  type SandboxRequest,
  type ValidatorOutcome,
} from "@nojv/core";
import { describe, expect, it } from "vitest";

import { mergeCheckerResults } from "../../../apps/worker/src/services/check-standard";
import { buildRunConfigMapData } from "../../../apps/worker/src/services/k8s-configmaps";
import { buildStageJobManifest } from "../../../apps/worker/src/services/k8s-job-manifests";
import { buildJudgePayload } from "../../../apps/worker/src/services/stage-result";

function makeCheckerRequest(overrides?: {
  testcases?: SandboxRequest["testcases"];
  checkerScript?: string;
  checkerLanguage?: "python" | "cpp";
}): SandboxRequest {
  return {
    submissionId: "sub-1",
    sourceCode: "print(1)",
    language: "python",
    problemType: "full_source",
    testcases: overrides?.testcases ?? [
      { index: 0, input: "1\n", output: "ans-0\n", weight: 1, isSample: false },
      { index: 1, input: "2\n", output: "ans-1\n", weight: 1, isSample: false },
    ],
    judgeType: "checker",
    judgeConfig: {
      checkerScript: overrides?.checkerScript ?? "accept()\n",
      checkerLanguage: overrides?.checkerLanguage ?? "python",
    },
    limits: { timeoutMs: 1_000, memoryMb: 256 },
  };
}

describe("buildRunConfigMapData — checker run pod must not see answer or validator", () => {
  it("excludes every testcase-{i}-expected.txt key for checker", () => {
    const tcs = Array.from({ length: 6 }, (_, i) => ({
      index: i,
      input: `in-${String(i)}\n`,
      output: `secret-answer-${String(i)}\n`,
      weight: 1,
      isSample: false,
    }));
    const data = buildRunConfigMapData(makeCheckerRequest({ testcases: tcs }), 1);

    for (let i = 0; i < tcs.length; i++) {
      expect(data[`testcase-${String(i)}-input.txt`]).toBe(`in-${String(i)}\n`);
      expect(data[`testcase-${String(i)}-expected.txt`]).toBeUndefined();
    }
    for (const value of Object.values(data)) {
      expect(value).not.toContain("secret-answer-");
    }
  });

  it("excludes the checker.<ext> key for checker", () => {
    const data = buildRunConfigMapData(
      makeCheckerRequest({ checkerScript: "VERY_SECRET_CHECKER\n", checkerLanguage: "python" }),
      1,
    );
    expect(data["checker.py"]).toBeUndefined();
    for (const value of Object.values(data)) {
      expect(value).not.toContain("VERY_SECRET_CHECKER");
    }
  });

  it("excludes the checker.cpp key for cpp checker", () => {
    const data = buildRunConfigMapData(
      makeCheckerRequest({ checkerScript: "int main(){}\n", checkerLanguage: "cpp" }),
      1,
    );
    expect(data["checker.cpp"]).toBeUndefined();
  });

  it("still writes source + config.json + input keys for the run", () => {
    const data = buildRunConfigMapData(makeCheckerRequest(), 2);
    const config = JSON.parse(data["config.json"]!) as {
      sourceFileMap?: { path: string; key: string }[];
      mode?: unknown;
    };
    expect(config.mode).toEqual({ kind: "run-stage", caseIndices: [0, 1], parallelism: 2 });
    const mainEntry = config.sourceFileMap?.find((e) => e.path === "main.py");
    expect(mainEntry).toBeDefined();
    expect(data[mainEntry!.key]).toBe("print(1)");
    expect(data["testcase-0-input.txt"]).toBe("1\n");
  });

  it("standard mode still excludes expected (regression: existing gate intact)", () => {
    const data = buildRunConfigMapData(
      {
        ...makeCheckerRequest(),
        judgeType: "standard",
        judgeConfig: {},
      },
      1,
    );
    expect(data["testcase-0-expected.txt"]).toBeUndefined();
    expect(data["testcase-0-input.txt"]).toBe("1\n");
  });

  it("checker request with no checker script does not write a checker key (defensive)", () => {
    const data = buildRunConfigMapData(
      {
        ...makeCheckerRequest(),
        judgeConfig: { checkerLanguage: "python" },
      },
      1,
    );
    expect(data["checker.py"]).toBeUndefined();
  });
});

describe("buildJudgePayload — only the judge container receives answers", () => {
  it("ships the validator, inputs and answers for a checker, but never the student source", () => {
    const data = buildJudgePayload(makeCheckerRequest());
    expect(data["validator.py"]).toBe("accept()\n");
    expect(data["case-0-input.txt"]).toBe("1\n");
    expect(data["case-0-answer.txt"]).toBe("ans-0\n");
    expect(data["case-1-answer.txt"]).toBe("ans-1\n");
    expect(Object.keys(data).some((key) => key.endsWith("-team.txt"))).toBe(false);
    for (const value of Object.values(data)) expect(value).not.toContain("print(1)");
    const config = JSON.parse(data["config.json"]!) as Record<string, unknown>;
    expect(config.validate).toEqual({ language: "python" });
    expect(config.mode).toEqual({ kind: "judge-stage" });
  });

  it("uses the cpp extension when checkerLanguage is cpp", () => {
    const data = buildJudgePayload(
      makeCheckerRequest({ checkerLanguage: "cpp", checkerScript: "int main(){}\n" }),
    );
    expect(data["validator.cpp"]).toBe("int main(){}\n");
    expect(data["validator.py"]).toBeUndefined();
  });

  it("ships only answers and the compare options for standard judging", () => {
    const data = buildJudgePayload({
      ...makeCheckerRequest(),
      judgeType: "standard",
      judgeConfig: { compare: { caseSensitive: false, floatTolerance: 1e-6 } },
    });
    expect(data["case-0-answer.txt"]).toBe("ans-0\n");
    expect(data["case-0-input.txt"]).toBeUndefined();
    expect(data["validator.py"]).toBeUndefined();
    const config = JSON.parse(data["config.json"]!) as Record<string, unknown>;
    expect(config.compare).toEqual({ caseSensitive: false, floatTolerance: 1e-6 });
    expect(config.validate).toBeUndefined();
  });

  it("skips testcases without an expected answer", () => {
    const data = buildJudgePayload(
      makeCheckerRequest({
        testcases: [
          { index: 0, input: "1\n", output: "ans-0\n", weight: 1, isSample: false },
          { index: 1, input: "2\n", weight: 1, isSample: false },
        ],
      }),
    );
    expect(data["case-0-answer.txt"]).toBe("ans-0\n");
    expect(data["case-1-input.txt"]).toBeUndefined();
    expect(data["case-1-answer.txt"]).toBeUndefined();
  });
});

describe("buildStageJobManifest — prepare, run and judge in one hardened Pod", () => {
  const params = {
    jobName: "judge-sub-1",
    namespace: "nojv-sandbox",
    runConfigMapNames: ["judge-sub-1-run-pm", "judge-sub-1-run-p0"],
    judgeConfigMapNames: ["judge-sub-1-judge-pm"],
    image: "nojv-sandbox:test",
    cpuRequest: "300m",
    cpuLimit: "1",
    memoryRequest: "64Mi",
    compilerMemoryLimit: "512Mi",
    runParallelism: 2,
    runMemoryLimit: "704Mi",
    activeDeadlineSeconds: 120,
    runtimeClassName: "gvisor",
  };
  const pod = buildStageJobManifest(params).spec!.template.spec!;
  const [prepare, run] = pod.initContainers!;
  const judge = pod.containers[0]!;

  it("orders prepare and run before the judge, each with its phase", () => {
    expect(pod.runtimeClassName).toBe("gvisor");
    expect(pod.initContainers!.map(({ name }) => name)).toEqual(["prepare", "run"]);
    expect(pod.containers.map(({ name }) => name)).toEqual(["judge"]);
    expect(prepare!.env).toContainEqual({ name: "SANDBOX_PHASE", value: "prepare" });
    expect(run!.env).toContainEqual({ name: "SANDBOX_PHASE", value: "run-stage" });
    expect(judge.env).toContainEqual({ name: "SANDBOX_PHASE", value: "judge-stage" });
  });

  it("reserves exactly runParallelism CPUs for the run container", () => {
    expect(run!.resources).toEqual({
      requests: { cpu: "2", memory: "64Mi" },
      limits: { cpu: "2", memory: "704Mi" },
    });
    expect(prepare!.resources?.limits).toEqual({ cpu: "1", memory: "512Mi" });
  });

  it("never mounts answers or the validator where student code runs", () => {
    const judgeVolumes = ["judge-payload", "judge-data", "judge-artifact"];
    for (const container of [prepare!, run!]) {
      expect(container.volumeMounts!.some(({ name }) => judgeVolumes.includes(name))).toBe(
        false,
      );
    }
    expect(run!.volumeMounts).toContainEqual({ name: "outputs", mountPath: "/outputs" });
    expect(run!.volumeMounts).toContainEqual({
      name: "submission-data",
      mountPath: "/submission",
      readOnly: true,
    });
    expect(judge.volumeMounts).toContainEqual({
      name: "outputs",
      mountPath: "/outputs",
      readOnly: true,
    });
    expect(judge.volumeMounts).toContainEqual({
      name: "judge-payload",
      mountPath: "/payload",
      readOnly: true,
    });
    expect(
      pod.volumes!.find(({ name }) => name === "judge-payload")?.projected?.sources,
    ).toEqual([{ configMap: { name: "judge-sub-1-judge-pm" } }]);
  });

  it("applies the full sandbox hardening profile to every container", () => {
    expect(pod.restartPolicy).toBe("Never");
    expect(pod.automountServiceAccountToken).toBe(false);
    expect(pod.nodeSelector).toEqual({ "nojv-role": "sandbox" });
    expect(pod.securityContext).toMatchObject({
      runAsUser: 10001,
      runAsGroup: 10001,
      runAsNonRoot: true,
      seccompProfile: { type: "RuntimeDefault" },
    });
    for (const container of [prepare!, run!, judge]) {
      expect(container.securityContext).toMatchObject({
        allowPrivilegeEscalation: false,
        capabilities: { drop: ["ALL"] },
        readOnlyRootFilesystem: true,
        runAsNonRoot: true,
      });
    }
  });

  it("limits TTL and active deadline", () => {
    const manifest = buildStageJobManifest(params);
    expect(manifest.spec!.ttlSecondsAfterFinished).toBeGreaterThan(0);
    expect(manifest.spec!.activeDeadlineSeconds).toBe(120);
    expect(manifest.spec!.backoffLimit).toBe(0);
  });
});

describe("K8s checker uses the same mergeCheckerResults as Docker", () => {
  it("error rawRuns pass through, valid outcomes become verdicts, missing outcomes are SE", () => {
    const rawRuns: RawCaseRun[] = [
      { index: 0, stdout: "ok\n", stderr: "", exitCode: 0, timeMs: 5 },
      { index: 1, stdout: "", stderr: "tle", exitCode: -1, timeMs: 1000, errorVerdict: "TLE" },
      { index: 2, stdout: "bad\n", stderr: "", exitCode: 0, timeMs: 7 },
    ];
    const outcomes = new Map<number, ValidatorOutcome>([
      [0, { verdict: "AC" }],
      [2, { verdict: "WA" }],
    ]);

    const merged = mergeCheckerResults(rawRuns, outcomes, makeCheckerRequest().testcases);

    expect(merged[0]!.verdict).toBe("AC");
    expect(merged[1]!.verdict).toBe("TLE");
    expect(merged[2]!.verdict).toBe("WA");
  });
});

function stagePod(overrides: Partial<Parameters<typeof buildStageJobManifest>[0]>) {
  return buildStageJobManifest({
    jobName: "quantities",
    namespace: "nojv-sandbox",
    runConfigMapNames: ["payload"],
    judgeConfigMapNames: ["judge"],
    image: "sandbox:test",
    cpuRequest: "0.5",
    cpuLimit: "750m",
    memoryRequest: "64Mi",
    compilerMemoryLimit: "512Mi",
    runParallelism: 1,
    runMemoryLimit: "208Mi",
    activeDeadlineSeconds: 90,
    ...overrides,
  }).spec!.template.spec!;
}

it("caps resource requests at the derived low problem limit while reserving compiler memory separately", () => {
  const memoryMb = resolveContainerMemoryMb(16, {
    defaultMemoryMb: 512,
    headroomMb: 64,
    maxMemoryMb: 1536,
  });
  expect(memoryMb).toBe(80);
  const pod = stagePod({ cpuLimit: "0.05", memoryRequest: "128Mi", runMemoryLimit: "80Mi" });
  expect(pod.initContainers![0]!.resources).toEqual({
    requests: { cpu: "0.05", memory: "128Mi" },
    limits: { cpu: "0.05", memory: "512Mi" },
  });
  expect(pod.initContainers![1]!.resources?.requests?.memory).toBe("80Mi");
});

it.each([
  { memoryRequest: "1.5Gi", memoryLimit: "1Gi", expected: "1Gi" },
  { memoryRequest: "1.5Gi", memoryLimit: "2Gi", expected: "1.5Gi" },
  { memoryRequest: "0.5G", memoryLimit: "400M", expected: "400M" },
  { memoryRequest: "0.5G", memoryLimit: "512Mi", expected: "0.5G" },
  { memoryRequest: "1e8", memoryLimit: "128Mi", expected: "1e8" },
])(
  "compares valid fractional and exponent quantities without changing under-limit text: $memoryRequest",
  ({ memoryRequest, memoryLimit, expected }) => {
    const pod = stagePod({ memoryRequest, runMemoryLimit: memoryLimit });
    expect(pod.initContainers![1]!.resources?.requests?.memory).toBe(expected);
  },
);

it("rejects non-finite resource quantities", () => {
  expect(() => stagePod({ memoryRequest: "1e309" })).toThrow(
    "Invalid Kubernetes resource quantity",
  );
});
