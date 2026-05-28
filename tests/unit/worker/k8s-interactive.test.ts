import type { SandboxRequest, SandboxTestcase } from "@nojv/core";
import { describe, expect, it } from "vitest";

import {
  INTERACTIVE_SOCKET_PORT,
  buildInteractiveInteractorConfigMapData,
  buildInteractiveJobManifest,
  buildInteractiveSolutionConfigMapData,
  buildInteractorContainerCommand,
  buildSolutionContainerCommand,
} from "../../../apps/worker/src/services/k8s-executor";

const STUDENT_SOURCE = "print(input())";
const SECRET_INPUT = "SECRET_INPUT_42\n";
const SECRET_ANSWER = "SECRET_ANSWER_42\n";
const INTERACTOR_SCRIPT = "SECRET_INTERACTOR_BODY\n";

function makeInteractiveRequest(overrides?: {
  interactorLanguage?: "python" | "cpp";
  testcases?: SandboxTestcase[];
}): SandboxRequest {
  return {
    submissionId: "sub-int-1",
    sourceCode: STUDENT_SOURCE,
    language: "python",
    problemType: "full_source",
    testcases: overrides?.testcases ?? [
      { index: 0, input: SECRET_INPUT, output: SECRET_ANSWER, weight: 1, isSample: false },
    ],
    judgeType: "interactive",
    judgeConfig: {
      interactorScript: INTERACTOR_SCRIPT,
      interactorLanguage: overrides?.interactorLanguage ?? "python",
    },
    limits: { timeoutMs: 2_000, memoryMb: 256 },
  };
}

describe("buildInteractiveSolutionConfigMapData — solution container must NOT see any secret", () => {
  it("writes source + config.json with role=solution", () => {
    const data = buildInteractiveSolutionConfigMapData(makeInteractiveRequest());
    expect(data["main.py"]).toBe(STUDENT_SOURCE);
    const config = JSON.parse(data["config.json"]!) as {
      interactive: { role: string };
      judgeType: string;
    };
    expect(config.interactive).toEqual({ role: "solution" });
    expect(config.judgeType).toBe("interactive");
  });

  it("contains NO input key, NO answer key, NO interactor script", () => {
    const tcs: SandboxTestcase[] = [
      { index: 0, input: SECRET_INPUT, output: SECRET_ANSWER, weight: 1, isSample: false },
      { index: 1, input: "in-1\n", output: "ans-1\n", weight: 1, isSample: false },
    ];
    const data = buildInteractiveSolutionConfigMapData(
      makeInteractiveRequest({ testcases: tcs }),
    );

    // No per-case keys in either layout.
    for (const i of [0, 1]) {
      expect(data[`case-${String(i)}-input.txt`]).toBeUndefined();
      expect(data[`case-${String(i)}-answer.txt`]).toBeUndefined();
      expect(data[`testcase-${String(i)}-input.txt`]).toBeUndefined();
      expect(data[`testcase-${String(i)}-expected.txt`]).toBeUndefined();
    }
    expect(data["interactor.py"]).toBeUndefined();
    expect(data["interactor.cpp"]).toBeUndefined();

    // Defence in depth — no value in the ConfigMap may carry any secret blob.
    for (const value of Object.values(data)) {
      expect(value).not.toContain("SECRET_INPUT_42");
      expect(value).not.toContain("SECRET_ANSWER_42");
      expect(value).not.toContain("SECRET_INTERACTOR_BODY");
    }
  });
});

describe("buildInteractiveInteractorConfigMapData — interactor container holds the secret, NOT the source", () => {
  const tcs: SandboxTestcase[] = [
    { index: 0, input: "in-0\n", output: "ans-0\n", weight: 1, isSample: false },
    { index: 2, input: SECRET_INPUT, output: SECRET_ANSWER, weight: 1, isSample: false },
  ];

  it("ships interactor.<ext>, case-{i}-input.txt, case-{i}-answer.txt, config.json with role=validator", () => {
    const req = makeInteractiveRequest({ testcases: tcs });
    const data = buildInteractiveInteractorConfigMapData(req, tcs[1]!);

    expect(data["interactor.py"]).toBe(INTERACTOR_SCRIPT);
    expect(data["case-2-input.txt"]).toBe(SECRET_INPUT);
    expect(data["case-2-answer.txt"]).toBe(SECRET_ANSWER);

    const config = JSON.parse(data["config.json"]!) as {
      interactive: { role: string; language: string; index: number };
      judgeType: string;
    };
    expect(config.interactive).toEqual({ role: "validator", language: "python", index: 2 });
    expect(config.judgeType).toBe("interactive");
  });

  it("uses the cpp extension when interactorLanguage is cpp", () => {
    const req = makeInteractiveRequest({ interactorLanguage: "cpp", testcases: tcs });
    const data = buildInteractiveInteractorConfigMapData(req, tcs[0]!);
    expect(data["interactor.cpp"]).toBeDefined();
    expect(data["interactor.py"]).toBeUndefined();
  });

  it("contains NO student source", () => {
    const req = makeInteractiveRequest({ testcases: tcs });
    const data = buildInteractiveInteractorConfigMapData(req, tcs[1]!);
    expect(data["main.py"]).toBeUndefined();
    for (const value of Object.values(data)) {
      expect(value).not.toContain(STUDENT_SOURCE);
    }
  });

  it("ships ONLY the requested testcase — sibling cases stay isolated", () => {
    const req = makeInteractiveRequest({ testcases: tcs });
    const data = buildInteractiveInteractorConfigMapData(req, tcs[1]!);
    // The non-requested case must NOT leak into this container.
    expect(data["case-0-input.txt"]).toBeUndefined();
    expect(data["case-0-answer.txt"]).toBeUndefined();
  });

  it("answer.txt defaults to empty string when the testcase has no expected output", () => {
    const tcsNoAnswer: SandboxTestcase[] = [
      { index: 0, input: "in\n", weight: 1, isSample: false },
    ];
    const req = makeInteractiveRequest({ testcases: tcsNoAnswer });
    const data = buildInteractiveInteractorConfigMapData(req, tcsNoAnswer[0]!);
    expect(data["case-0-answer.txt"]).toBe("");
  });
});

describe("socat command wrappers", () => {
  it("interactor side LISTENs on the shared port with reuseaddr", () => {
    const cmd = buildInteractorContainerCommand();
    expect(cmd[0]).toBe("sh");
    expect(cmd[1]).toBe("-c");
    const script = cmd[2]!;
    expect(script).toContain("socat");
    expect(script).toContain(`TCP-LISTEN:${String(INTERACTIVE_SOCKET_PORT)}`);
    expect(script).toContain("reuseaddr");
    expect(script).toContain('EXEC:"node /runner/index.js"');
  });

  it("solution side connects to 127.0.0.1 with retry over a tight interval", () => {
    const cmd = buildSolutionContainerCommand();
    expect(cmd[0]).toBe("sh");
    expect(cmd[1]).toBe("-c");
    const script = cmd[2]!;
    expect(script).toContain("socat");
    expect(script).toContain(`TCP:127.0.0.1:${String(INTERACTIVE_SOCKET_PORT)}`);
    expect(script).toMatch(/retry=\d+/);
    expect(script).toMatch(/interval=/);
    expect(script).toContain('EXEC:"node /runner/index.js"');
  });

  it("listener has no retry — only the connecting side races against pod startup", () => {
    const sol = buildSolutionContainerCommand()[2]!;
    const int = buildInteractorContainerCommand()[2]!;
    expect(int).not.toContain("retry=");
    expect(sol).toContain("retry=");
  });
});

describe("buildInteractiveJobManifest — per-container volumeMounts isolate the secret", () => {
  const params = {
    jobName: "judge-sub-int-1-case-2",
    namespace: "nojv-sandbox",
    solutionConfigMapName: "judge-sub-int-1-case-2-sol",
    interactorConfigMapName: "judge-sub-int-1-case-2-int",
    image: "nojv-sandbox:test",
    cpuRequest: "100m",
    cpuLimit: "1",
    memoryRequest: "128Mi",
    memoryLimit: "256Mi",
    activeDeadlineSeconds: 40,
  };

  it("pod template has exactly two containers named 'solution' and 'interactor'", () => {
    const manifest = buildInteractiveJobManifest(params);
    const containers = manifest.spec!.template.spec!.containers;
    expect(containers.length).toBe(2);
    const names = containers.map((c) => c.name).sort();
    expect(names).toEqual(["interactor", "solution"]);
  });

  it("solution container mounts ONLY the solution ConfigMap at /submission — NOT the interactor ConfigMap", () => {
    const manifest = buildInteractiveJobManifest(params);
    const containers = manifest.spec!.template.spec!.containers;
    const sol = containers.find((c) => c.name === "solution")!;

    const submission = sol.volumeMounts!.find((m) => m.mountPath === "/submission");
    expect(submission?.name).toBe("solution-data");
    expect(submission?.readOnly).toBe(true);

    // SECURITY: the interactor's volume must not appear anywhere on the solution container.
    for (const mount of sol.volumeMounts!) {
      expect(mount.name).not.toBe("interactor-data");
    }
    expect(JSON.stringify(sol)).not.toContain("interactor-data");
  });

  it("interactor container mounts ONLY the interactor ConfigMap at /submission — NOT the solution ConfigMap", () => {
    const manifest = buildInteractiveJobManifest(params);
    const containers = manifest.spec!.template.spec!.containers;
    const int = containers.find((c) => c.name === "interactor")!;

    const submission = int.volumeMounts!.find((m) => m.mountPath === "/submission");
    expect(submission?.name).toBe("interactor-data");
    expect(submission?.readOnly).toBe(true);

    for (const mount of int.volumeMounts!) {
      expect(mount.name).not.toBe("solution-data");
    }
    expect(JSON.stringify(int)).not.toContain("solution-data");
  });

  it("pod-level volumes reference the two distinct ConfigMaps", () => {
    const manifest = buildInteractiveJobManifest(params);
    const volumes = manifest.spec!.template.spec!.volumes!;
    const solVol = volumes.find((v) => v.name === "solution-data");
    const intVol = volumes.find((v) => v.name === "interactor-data");
    expect(solVol?.configMap?.name).toBe("judge-sub-int-1-case-2-sol");
    expect(intVol?.configMap?.name).toBe("judge-sub-int-1-case-2-int");
  });

  it("both containers get separate emptyDir /workspace + /tmp scratch", () => {
    const manifest = buildInteractiveJobManifest(params);
    const containers = manifest.spec!.template.spec!.containers;
    for (const c of containers) {
      const workspace = c.volumeMounts!.find((m) => m.mountPath === "/workspace");
      const tmp = c.volumeMounts!.find((m) => m.mountPath === "/tmp");
      expect(workspace).toBeDefined();
      expect(tmp).toBeDefined();
    }
  });

  it("applies the same hardening profile to both containers as the standard run pod", () => {
    const manifest = buildInteractiveJobManifest(params);
    const podSpec = manifest.spec!.template.spec!;

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

    for (const container of podSpec.containers) {
      expect(container.securityContext).toMatchObject({
        allowPrivilegeEscalation: false,
        capabilities: { drop: ["ALL"] },
        readOnlyRootFilesystem: true,
        runAsNonRoot: true,
      });
    }
    expect(manifest.spec!.template.metadata!.labels).toMatchObject({ app: "nojv-sandbox" });
  });

  it("Job spec has restartPolicy=Never, backoffLimit=0, ttl, and the supplied activeDeadlineSeconds", () => {
    const manifest = buildInteractiveJobManifest(params);
    expect(manifest.spec!.ttlSecondsAfterFinished).toBeGreaterThan(0);
    expect(manifest.spec!.activeDeadlineSeconds).toBe(40);
    expect(manifest.spec!.backoffLimit).toBe(0);
  });

  it("each container runs its socat wrapper command", () => {
    const manifest = buildInteractiveJobManifest(params);
    const containers = manifest.spec!.template.spec!.containers;
    const sol = containers.find((c) => c.name === "solution")!;
    const int = containers.find((c) => c.name === "interactor")!;

    expect(sol.command).toEqual(buildSolutionContainerCommand());
    expect(int.command).toEqual(buildInteractorContainerCommand());
  });
});

describe("K8s interactive uses the same mergeInteractiveCase as Docker (DRY invariant)", () => {
  it("a clean run + interactor AC merges to AC at score 100 — same as Docker", async () => {
    const interactiveK8s = await import("../../../apps/worker/src/services/check-interactive");
    const interactiveDocker =
      await import("../../../apps/worker/src/services/interactive-executor");
    expect(interactiveDocker.mergeInteractiveCase).toBe(interactiveK8s.mergeInteractiveCase);
  });
});
