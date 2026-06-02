import type { RawCaseRun, SandboxRequest, ValidatorOutcome } from "@nojv/core";
import { describe, expect, it } from "vitest";

import { mergeCheckerResults } from "../../../apps/worker/src/services/check-standard";
import {
  buildRunConfigMapData,
  buildSandboxJobManifest,
  buildValidateConfigMapData,
} from "../../../apps/worker/src/services/k8s-executor";

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
    const data = buildRunConfigMapData(makeCheckerRequest({ testcases: tcs }));

    for (let i = 0; i < tcs.length; i++) {
      expect(data[`testcase-${String(i)}-input.txt`]).toBe(`in-${String(i)}\n`);
      expect(data[`testcase-${String(i)}-expected.txt`]).toBeUndefined();
    }
    // Defense-in-depth: no value in the run ConfigMap may carry the secret answer.
    for (const value of Object.values(data)) {
      expect(value).not.toContain("secret-answer-");
    }
  });

  it("excludes the checker.<ext> key for checker", () => {
    const data = buildRunConfigMapData(
      makeCheckerRequest({ checkerScript: "VERY_SECRET_CHECKER\n", checkerLanguage: "python" }),
    );
    expect(data["checker.py"]).toBeUndefined();
    for (const value of Object.values(data)) {
      expect(value).not.toContain("VERY_SECRET_CHECKER");
    }
  });

  it("excludes the checker.cpp key for cpp checker", () => {
    const data = buildRunConfigMapData(
      makeCheckerRequest({ checkerScript: "int main(){}\n", checkerLanguage: "cpp" }),
    );
    expect(data["checker.cpp"]).toBeUndefined();
  });

  it("still writes source + config.json + input keys for the run", () => {
    const data = buildRunConfigMapData(makeCheckerRequest());
    expect(data["main.py"]).toBe("print(1)");
    expect(data["config.json"]).toBeDefined();
    expect(data["testcase-0-input.txt"]).toBe("1\n");
  });

  it("standard mode still excludes expected (regression: existing gate intact)", () => {
    const data = buildRunConfigMapData({
      ...makeCheckerRequest(),
      judgeType: "standard",
      judgeConfig: {},
    });
    expect(data["testcase-0-expected.txt"]).toBeUndefined();
    expect(data["testcase-0-input.txt"]).toBe("1\n");
  });

  it("checker request with no checker script does not write a checker key (defensive)", () => {
    const data = buildRunConfigMapData({
      ...makeCheckerRequest(),
      judgeConfig: { checkerLanguage: "python" },
    });
    expect(data["checker.py"]).toBeUndefined();
  });
});

describe("buildValidateConfigMapData — validate pod ships validator + per-case files", () => {
  const rawRuns: RawCaseRun[] = [
    { index: 0, stdout: "team-0\n", stderr: "", exitCode: 0, timeMs: 10 },
    { index: 1, stdout: "team-1\n", stderr: "", exitCode: 0, timeMs: 12 },
  ];

  it("writes validator.<ext> with the validator script", () => {
    const data = buildValidateConfigMapData(makeCheckerRequest(), rawRuns);
    expect(data["validator.py"]).toBe("accept()\n");
  });

  it("uses the cpp extension when checkerLanguage is cpp", () => {
    const data = buildValidateConfigMapData(
      makeCheckerRequest({ checkerLanguage: "cpp", checkerScript: "int main(){}\n" }),
      rawRuns,
    );
    expect(data["validator.cpp"]).toBe("int main(){}\n");
    expect(data["validator.py"]).toBeUndefined();
  });

  it("writes config.json carrying the validate block with case indices", () => {
    const data = buildValidateConfigMapData(makeCheckerRequest(), rawRuns);
    const config = JSON.parse(data["config.json"]!) as {
      validate?: { language: string; cases: { index: number }[] };
      submissionId?: string;
      judgeType?: string;
    };
    expect(config.submissionId).toBe("sub-1");
    expect(config.judgeType).toBe("checker");
    expect(config.validate).toEqual({
      language: "python",
      cases: [{ index: 0 }, { index: 1 }],
    });
  });

  it("writes per-case flat keys for input/answer/team", () => {
    const data = buildValidateConfigMapData(makeCheckerRequest(), rawRuns);
    expect(data["case-0-input.txt"]).toBe("1\n");
    expect(data["case-0-answer.txt"]).toBe("ans-0\n");
    expect(data["case-0-team.txt"]).toBe("team-0\n");
    expect(data["case-1-input.txt"]).toBe("2\n");
    expect(data["case-1-answer.txt"]).toBe("ans-1\n");
    expect(data["case-1-team.txt"]).toBe("team-1\n");
  });

  it("skips cases whose run errored (TLE/MLE/RE/SE) — validator never grades them", () => {
    const mixed: RawCaseRun[] = [
      { index: 0, stdout: "ok\n", stderr: "", exitCode: 0, timeMs: 5 },
      { index: 1, stdout: "", stderr: "boom", exitCode: -1, timeMs: 0, errorVerdict: "TLE" },
    ];
    const data = buildValidateConfigMapData(makeCheckerRequest(), mixed);
    expect(data["case-0-team.txt"]).toBe("ok\n");
    expect(data["case-1-team.txt"]).toBeUndefined();
    expect(data["case-1-input.txt"]).toBeUndefined();
    expect(data["case-1-answer.txt"]).toBeUndefined();

    const config = JSON.parse(data["config.json"]!) as {
      validate: { cases: { index: number }[] };
    };
    expect(config.validate.cases).toEqual([{ index: 0 }]);
  });

  it("skips cases whose testcase has no expected answer (misconfiguration → merge SE)", () => {
    const tcs = [
      { index: 0, input: "1\n", output: "ans-0\n", weight: 1, isSample: false },
      { index: 1, input: "2\n", weight: 1, isSample: false },
    ];
    const data = buildValidateConfigMapData(makeCheckerRequest({ testcases: tcs }), rawRuns);
    expect(data["case-0-input.txt"]).toBe("1\n");
    expect(data["case-1-input.txt"]).toBeUndefined();
  });

  it("never ships the student source code into the validate ConfigMap", () => {
    const data = buildValidateConfigMapData(makeCheckerRequest(), rawRuns);
    expect(data["main.py"]).toBeUndefined();
    for (const value of Object.values(data)) {
      expect(value).not.toContain("print(1)");
    }
  });
});

describe("buildSandboxJobManifest — hardening parity for both run and validate pods", () => {
  const baseParams = {
    jobName: "judge-sub-1",
    namespace: "nojv-sandbox",
    configMapName: "judge-sub-1",
    image: "nojv-sandbox:test",
    cpuRequest: "100m",
    cpuLimit: "1",
    memoryRequest: "128Mi",
    memoryLimit: "256Mi",
  };

  it.each([
    ["run", { ...baseParams }],
    [
      "validate",
      { ...baseParams, jobName: "judge-sub-1-validate", configMapName: "judge-sub-1-validate" },
    ],
  ])("(%s) applies the full sandbox hardening profile", (_label, params) => {
    const manifest = buildSandboxJobManifest(params);
    const podSpec = manifest.spec!.template.spec!;
    const container = podSpec.containers[0]!;

    expect(podSpec.restartPolicy).toBe("Never");
    expect(podSpec.automountServiceAccountToken).toBe(false);
    expect(podSpec.nodeSelector).toEqual({ "nojv-role": "sandbox" });
    expect(podSpec.tolerations).toEqual([
      { key: "nojv-role", operator: "Equal", value: "sandbox", effect: "NoSchedule" },
    ]);
    expect(podSpec.securityContext).toMatchObject({
      runAsUser: 10001,
      runAsGroup: 10001,
      runAsNonRoot: true,
      seccompProfile: { type: "RuntimeDefault" },
    });
    expect(container.securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
      readOnlyRootFilesystem: true,
      runAsNonRoot: true,
    });
    expect(manifest.spec!.template.metadata!.labels).toMatchObject({ app: "nojv-sandbox" });
  });

  it("uses the supplied ConfigMap as the read-only /submission mount", () => {
    const manifest = buildSandboxJobManifest({
      ...baseParams,
      jobName: "judge-sub-1-validate",
      configMapName: "judge-sub-1-validate",
    });
    const podSpec = manifest.spec!.template.spec!;
    const submissionVol = podSpec.volumes!.find((v) => v.name === "submission-data");
    expect(submissionVol?.configMap?.name).toBe("judge-sub-1-validate");

    const container = podSpec.containers[0]!;
    const mount = container.volumeMounts!.find((m) => m.name === "submission-data");
    expect(mount?.mountPath).toBe("/submission");
    expect(mount?.readOnly).toBe(true);
  });

  it("limits TTL and active deadline", () => {
    const manifest = buildSandboxJobManifest(baseParams);
    expect(manifest.spec!.ttlSecondsAfterFinished).toBeGreaterThan(0);
    expect(manifest.spec!.activeDeadlineSeconds).toBeGreaterThan(0);
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
      [2, { verdict: "WA", score: 25 }],
    ]);

    const merged = mergeCheckerResults(rawRuns, outcomes);

    expect(merged[0]!.verdict).toBe("AC");
    expect(merged[0]!.score).toBe(100);
    expect(merged[1]!.verdict).toBe("TLE");
    expect(merged[2]!.verdict).toBe("WA");
    expect(merged[2]!.score).toBe(25);
  });
});
