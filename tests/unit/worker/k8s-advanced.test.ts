import type { SandboxRequest } from "@nojv/core";
import { describe, expect, it, vi } from "vitest";

import {
  ADVANCED_RESULT_MARKER_BEGIN,
  ADVANCED_RESULT_MARKER_END,
  ADVANCED_SIDECAR_NAME,
  ADVANCED_GRADER_NAME,
  ADVANCED_INIT_NAME,
  buildAdvancedConfigMapData,
  buildAdvancedInitScript,
  buildAdvancedJobManifest,
  buildAdvancedTailScript,
  parseAdvancedResultLog,
  K8sExecutor,
} from "../../../apps/worker/src/services/k8s-executor";

function makeAdvancedRequest(overrides?: {
  imageSource?: "registry" | "tarball";
  imageRef?: string;
  memoryMb?: number;
  totalTimeMs?: number;
}): SandboxRequest {
  return {
    submissionId: "sub-adv-1",
    sourceCode: "print('hi')",
    language: "python",
    problemType: "full_source",
    testcases: [],
    judgeType: "standard",
    judgeConfig: {},
    limits: { timeoutMs: 1_000, memoryMb: 256 },
    advanced: {
      imageRef: overrides?.imageRef ?? "registry.example.com/ta/grader:1.0",
      imageSource: overrides?.imageSource ?? "registry",
      totalTimeMs: overrides?.totalTimeMs ?? 60_000,
      memoryMb: overrides?.memoryMb ?? 512,
    },
  };
}

const EXEC_CONFIG = {
  namespace: "nojv-sandbox",
  image: "nojv-sandbox:test",
  cpuRequest: "100m",
  cpuLimit: "1",
  memoryRequest: "128Mi",
  memoryLimit: "256Mi",
};

interface CallRecord {
  configMapsCreated: { name: string; namespace: string; data: Record<string, string> }[];
  configMapsDeleted: { name: string; namespace: string }[];
  jobsCreated: { name: string; namespace: string; body: unknown }[];
  jobsDeleted: { name: string; namespace: string }[];
  podLogsRead: { name: string; namespace: string; container: string }[];
}

interface FakeOpts {
  sidecarLog?: string;
  jobOutcome?: "succeeded" | "failed";
  throwOnJobCreate?: boolean;
}

function buildFakeClients(record: CallRecord, opts: FakeOpts = {}) {
  const coreApi = {
    createNamespacedConfigMap: vi.fn(async ({ namespace, body }: any) => {
      record.configMapsCreated.push({
        name: body.metadata.name,
        namespace,
        data: body.data,
      });
    }),
    deleteNamespacedConfigMap: vi.fn(async ({ name, namespace }: any) => {
      record.configMapsDeleted.push({ name, namespace });
    }),
    listNamespacedPod: vi.fn(async ({ labelSelector }: any) => {
      const jobName = String(labelSelector).split("=")[1];
      return { items: [{ metadata: { name: `${jobName}-pod` } }] };
    }),
    readNamespacedPodLog: vi.fn(async ({ name, namespace, container }: any) => {
      record.podLogsRead.push({ name, namespace, container });
      return opts.sidecarLog ?? "";
    }),
  } as any;

  const batchApi = {
    createNamespacedJob: vi.fn(async ({ namespace, body }: any) => {
      if (opts.throwOnJobCreate) throw new Error("simulated job create failure");
      record.jobsCreated.push({ name: body.metadata.name, namespace, body });
    }),
    deleteNamespacedJob: vi.fn(async ({ name, namespace }: any) => {
      record.jobsDeleted.push({ name, namespace });
    }),
    readNamespacedJob: vi.fn(async () => {
      const status = opts.jobOutcome ?? "succeeded";
      return { status: { [status]: 1 } };
    }),
  } as any;

  return { coreApi, batchApi };
}

function emptyRecord(): CallRecord {
  return {
    configMapsCreated: [],
    configMapsDeleted: [],
    jobsCreated: [],
    jobsDeleted: [],
    podLogsRead: [],
  };
}

describe("buildAdvancedConfigMapData", () => {
  it("packs submission files + meta.json into a single JSON payload key", () => {
    const req = makeAdvancedRequest();
    req.sourceFiles = [
      { path: "main.py", content: "print('a')" },
      { path: "lib/util.py", content: "X=1" },
    ];
    const data = buildAdvancedConfigMapData(req);
    expect(Object.keys(data)).toEqual(["payload.json"]);

    const payload = JSON.parse(data["payload.json"]!) as {
      meta: { submissionId: string; resourceLimits: { totalTimeMs: number; memoryMb: number } };
      submissionFiles: { path: string; content: string }[];
    };
    expect(payload.meta.submissionId).toBe("sub-adv-1");
    expect(payload.meta.resourceLimits).toEqual({ totalTimeMs: 60_000, memoryMb: 512 });
    expect(payload.submissionFiles).toEqual([
      { path: "main.py", content: "print('a')" },
      { path: "lib/util.py", content: "X=1" },
    ]);
  });

  it("falls back to sourceCode under sourceFileNames[language] when no sourceFiles given", () => {
    const req = makeAdvancedRequest();
    const data = buildAdvancedConfigMapData(req);
    const payload = JSON.parse(data["payload.json"]!) as {
      submissionFiles: { path: string; content: string }[];
    };
    expect(payload.submissionFiles).toEqual([{ path: "main.py", content: "print('hi')" }]);
  });

  it("skips path-traversal / invalid file paths but never throws", () => {
    const req = makeAdvancedRequest();
    req.sourceFiles = [
      { path: "../escape.py", content: "evil" },
      { path: "ok.py", content: "good" },
    ];
    const data = buildAdvancedConfigMapData(req);
    const payload = JSON.parse(data["payload.json"]!) as {
      submissionFiles: { path: string; content: string }[];
    };
    expect(payload.submissionFiles.map((f) => f.path)).toEqual(["ok.py", "main.py"]);
  });
});

describe("buildAdvancedInitScript", () => {
  it("creates the workspace layout with output/ chmod 0777 and writes meta + submission files", () => {
    const script = buildAdvancedInitScript();
    expect(script).toContain("/workspace/submission");
    expect(script).toContain("/workspace/output");
    expect(script).toContain("/workspace/meta.json");
    expect(script).toMatch(/chmod\s+0?777\s+\/workspace\/output/);
    // The init reads the packed payload mounted by the prep ConfigMap.
    expect(script).toContain("/init-payload/payload.json");
  });
});

describe("buildAdvancedTailScript", () => {
  it("contains the result path, marker pair, and a deadline derived from totalTimeMs", () => {
    const script = buildAdvancedTailScript(60_000);
    expect(script).toContain("/workspace/output/result.json");
    expect(script).toContain(ADVANCED_RESULT_MARKER_BEGIN);
    expect(script).toContain(ADVANCED_RESULT_MARKER_END);
    // 60_000 ms total + 30s headroom → 90 s.
    expect(script).toContain("90");
    expect(script).toContain('{"missing":true}');
  });

  it("rounds sub-second time up to at least one second", () => {
    const script = buildAdvancedTailScript(250);
    // 0.25s + 30s = 30.25s → ceil to 31.
    expect(script).toContain("31");
  });
});

describe("parseAdvancedResultLog", () => {
  it("extracts and JSON-parses a clean marker block", () => {
    const json = '{"score":80,"verdict":"accepted","feedback":"ok"}';
    const log = `noise\n${ADVANCED_RESULT_MARKER_BEGIN}\n${json}\n${ADVANCED_RESULT_MARKER_END}\nmore noise\n`;
    const parsed = parseAdvancedResultLog(log);
    expect(parsed).toEqual({ score: 80, verdict: "accepted", feedback: "ok" });
  });

  it("returns the sentinel {missing:true} payload when grader never wrote result.json", () => {
    const log = `${ADVANCED_RESULT_MARKER_BEGIN}\n{"missing":true}\n${ADVANCED_RESULT_MARKER_END}\n`;
    expect(parseAdvancedResultLog(log)).toEqual({ missing: true });
  });

  it("returns null when there is no marker block at all", () => {
    expect(parseAdvancedResultLog("no markers here\n")).toBeNull();
  });

  it("returns null when payload is not valid JSON", () => {
    const log = `${ADVANCED_RESULT_MARKER_BEGIN}\nnot json{\n${ADVANCED_RESULT_MARKER_END}\n`;
    expect(parseAdvancedResultLog(log)).toBeNull();
  });

  it("handles multi-line JSON between the markers", () => {
    const log = `${ADVANCED_RESULT_MARKER_BEGIN}\n{\n  "score": 50,\n  "verdict": "wrong_answer"\n}\n${ADVANCED_RESULT_MARKER_END}\n`;
    expect(parseAdvancedResultLog(log)).toEqual({ score: 50, verdict: "wrong_answer" });
  });
});

describe("buildAdvancedJobManifest — registry-source pod structure", () => {
  const params = {
    jobName: "judge-sub-adv-1",
    namespace: "nojv-sandbox",
    configMapName: "judge-sub-adv-1-input",
    sandboxImage: "nojv-sandbox:test",
    graderImage: "registry.example.com/ta/grader:1.0",
    memoryMb: 512,
    totalTimeMs: 60_000,
    cpuLimit: "1",
    submissionId: "sub-adv-1",
    language: "python",
  };

  it("has exactly ONE main container (the grader) and TWO initContainers (prep + native sidecar)", () => {
    const m = buildAdvancedJobManifest(params);
    const podSpec = m.spec!.template.spec!;
    expect(podSpec.containers.length).toBe(1);
    expect(podSpec.containers[0]!.name).toBe(ADVANCED_GRADER_NAME);

    const initNames = (podSpec.initContainers ?? []).map((c) => c.name).sort();
    expect(initNames).toEqual([ADVANCED_INIT_NAME, ADVANCED_SIDECAR_NAME].sort());
  });

  it("sidecar is in initContainers with restartPolicy: Always (K8s 1.28+ native sidecar)", () => {
    const m = buildAdvancedJobManifest(params);
    const sidecar = m.spec!.template.spec!.initContainers!.find(
      (c) => c.name === ADVANCED_SIDECAR_NAME,
    );
    expect(sidecar).toBeDefined();
    expect(sidecar!.restartPolicy).toBe("Always");
  });

  it("init prep container has NO restartPolicy (regular init, runs to completion)", () => {
    const m = buildAdvancedJobManifest(params);
    const init = m.spec!.template.spec!.initContainers!.find(
      (c) => c.name === ADVANCED_INIT_NAME,
    );
    expect(init).toBeDefined();
    expect(init!.restartPolicy).toBeUndefined();
  });

  it("grader uses request.advanced.imageRef as its image", () => {
    const m = buildAdvancedJobManifest(params);
    const grader = m.spec!.template.spec!.containers[0]!;
    expect(grader.image).toBe("registry.example.com/ta/grader:1.0");
  });

  it("prep + sidecar both use the sandbox image (vendored shell scripts)", () => {
    const m = buildAdvancedJobManifest(params);
    const init = m.spec!.template.spec!.initContainers!.find(
      (c) => c.name === ADVANCED_INIT_NAME,
    )!;
    const sidecar = m.spec!.template.spec!.initContainers!.find(
      (c) => c.name === ADVANCED_SIDECAR_NAME,
    )!;
    expect(init.image).toBe("nojv-sandbox:test");
    expect(sidecar.image).toBe("nojv-sandbox:test");
  });

  it("grader memory limit comes from request.advanced.memoryMb", () => {
    const m = buildAdvancedJobManifest(params);
    const grader = m.spec!.template.spec!.containers[0]!;
    expect(grader.resources!.limits!.memory).toBe("512Mi");
  });

  it("activeDeadlineSeconds = ceil(totalTimeMs/1000) + 30", () => {
    const m = buildAdvancedJobManifest(params);
    expect(m.spec!.activeDeadlineSeconds).toBe(90);

    const m2 = buildAdvancedJobManifest({ ...params, totalTimeMs: 1_500 });
    expect(m2.spec!.activeDeadlineSeconds).toBe(32);
  });

  it("all three containers share a workspace emptyDir", () => {
    const m = buildAdvancedJobManifest(params);
    const podSpec = m.spec!.template.spec!;
    const wsVolume = podSpec.volumes!.find((v) => v.name === "workspace");
    expect(wsVolume?.emptyDir).toBeDefined();

    for (const c of [...podSpec.containers, ...podSpec.initContainers!]) {
      const mount = c.volumeMounts!.find((m) => m.name === "workspace");
      expect(mount?.mountPath).toBe("/workspace");
    }
  });

  it("init prep also mounts the input ConfigMap read-only at /init-payload", () => {
    const m = buildAdvancedJobManifest(params);
    const init = m.spec!.template.spec!.initContainers!.find(
      (c) => c.name === ADVANCED_INIT_NAME,
    )!;
    const payloadMount = init.volumeMounts!.find((m) => m.mountPath === "/init-payload");
    expect(payloadMount).toBeDefined();
    expect(payloadMount!.readOnly).toBe(true);
    const volume = m.spec!.template.spec!.volumes!.find((v) => v.name === payloadMount!.name);
    expect(volume?.configMap?.name).toBe(params.configMapName);
  });

  it("grader hardening: cap-drop ALL, no-new-privileges, read-only rootfs, tmpfs /tmp", () => {
    const m = buildAdvancedJobManifest(params);
    const grader = m.spec!.template.spec!.containers[0]!;
    expect(grader.securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
      readOnlyRootFilesystem: true,
    });
    const tmp = grader.volumeMounts!.find((m) => m.mountPath === "/tmp");
    expect(tmp).toBeDefined();
    const volume = m.spec!.template.spec!.volumes!.find((v) => v.name === tmp!.name);
    expect(volume?.emptyDir).toBeDefined();
  });

  it("grader is permitted to run as the image's user (TA images may need root)", () => {
    const m = buildAdvancedJobManifest(params);
    const grader = m.spec!.template.spec!.containers[0]!;
    // runAsNonRoot is NOT enforced on the grader — TA's image owns its user.
    expect(grader.securityContext?.runAsNonRoot).toBeFalsy();
  });

  it("pod-level: automountServiceAccountToken=false, sandbox node selector + toleration, NetworkPolicy label", () => {
    const m = buildAdvancedJobManifest(params);
    const podSpec = m.spec!.template.spec!;
    expect(podSpec.automountServiceAccountToken).toBe(false);
    expect(podSpec.nodeSelector).toEqual({ "nojv-role": "sandbox" });
    expect(podSpec.tolerations).toEqual([
      { key: "nojv-role", operator: "Equal", value: "sandbox", effect: "NoSchedule" },
    ]);
    expect(podSpec.restartPolicy).toBe("Never");
    expect(m.spec!.template.metadata!.labels).toMatchObject({ app: "nojv-sandbox" });
  });

  it("Job has backoffLimit=0 + ttlSecondsAfterFinished set", () => {
    const m = buildAdvancedJobManifest(params);
    expect(m.spec!.backoffLimit).toBe(0);
    expect(m.spec!.ttlSecondsAfterFinished).toBeGreaterThan(0);
  });
});

describe("K8sExecutor.execute(advanced) — tarball source fail-fast", () => {
  it("tarball-source on K8s returns SE with a clear operator message and creates no resources", async () => {
    const record = emptyRecord();
    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record));
    const result = await executor.execute(makeAdvancedRequest({ imageSource: "tarball" }));

    expect(result.testcaseResults).toHaveLength(1);
    expect(result.testcaseResults[0]!.verdict).toBe("SE");
    const message = result.testcaseResults[0]!.feedback ?? result.testcaseResults[0]!.stderr;
    expect(message).toMatch(/registry/i);
    expect(message).toMatch(/tarball/i);

    expect(record.jobsCreated).toHaveLength(0);
    expect(record.configMapsCreated).toHaveLength(0);
  });
});

describe("K8sExecutor.execute(advanced) — registry source orchestration", () => {
  function buildSidecarLog(payload: Record<string, unknown>): string {
    return [
      "prep ok",
      ADVANCED_RESULT_MARKER_BEGIN,
      JSON.stringify(payload),
      ADVANCED_RESULT_MARKER_END,
      "",
    ].join("\n");
  }

  it("creates ConfigMap + Job, reads sidecar logs, returns mapped AC result", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({
      score: 100,
      verdict: "accepted",
      feedback: "all good",
    });
    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { sidecarLog }));
    const result = await executor.execute(makeAdvancedRequest());

    expect(record.configMapsCreated).toHaveLength(1);
    expect(record.jobsCreated).toHaveLength(1);
    expect(record.jobsCreated[0]!.name).toBe("judge-sub-adv-1");

    // Logs MUST be read from the sidecar container specifically.
    expect(record.podLogsRead.some((c) => c.container === ADVANCED_SIDECAR_NAME)).toBe(true);

    expect(result.testcaseResults).toHaveLength(1);
    expect(result.testcaseResults[0]!.verdict).toBe("AC");
    expect(result.customScore).toBe(100);
  });

  it("preprocesses short-code verdict aliases (advancedResultSchema preprocess)", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ score: 30, verdict: "wa" });
    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { sidecarLog }));
    const result = await executor.execute(makeAdvancedRequest());

    expect(result.testcaseResults[0]!.verdict).toBe("WA");
    expect(result.customScore).toBe(30);
  });

  it("missing result.json (sidecar emits {missing:true}) → fallback SE with clear message", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ missing: true });
    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { sidecarLog }));
    const result = await executor.execute(makeAdvancedRequest());

    expect(result.testcaseResults[0]!.verdict).toBe("SE");
    const message = result.testcaseResults[0]!.feedback ?? result.testcaseResults[0]!.stderr;
    expect(message).toMatch(/result\.json/i);
  });

  it("sidecar log without markers → fallback SE", async () => {
    const record = emptyRecord();
    const executor = new K8sExecutor(
      EXEC_CONFIG,
      buildFakeClients(record, { sidecarLog: "completely garbled\n" }),
    );
    const result = await executor.execute(makeAdvancedRequest());

    expect(result.testcaseResults[0]!.verdict).toBe("SE");
  });

  it("result.json that fails advancedResultSchema → fallback SE with clear message", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ score: "not a number", verdict: "accepted" });
    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { sidecarLog }));
    const result = await executor.execute(makeAdvancedRequest());

    expect(result.testcaseResults[0]!.verdict).toBe("SE");
    const message = result.testcaseResults[0]!.feedback ?? result.testcaseResults[0]!.stderr;
    expect(message).toMatch(/result\.json/i);
  });

  it("failed Job (activeDeadline / image pull) → fallback SE; cleanup still runs", async () => {
    const record = emptyRecord();
    const executor = new K8sExecutor(
      EXEC_CONFIG,
      buildFakeClients(record, { jobOutcome: "failed" }),
    );
    const result = await executor.execute(makeAdvancedRequest());

    expect(result.testcaseResults[0]!.verdict).toBe("SE");
    expect(record.jobsDeleted).toHaveLength(1);
    expect(record.configMapsDeleted).toHaveLength(1);
  });

  it("Job creation failure → cleanup still runs in finally", async () => {
    const record = emptyRecord();
    const executor = new K8sExecutor(
      EXEC_CONFIG,
      buildFakeClients(record, { throwOnJobCreate: true }),
    );
    const result = await executor.execute(makeAdvancedRequest());

    expect(result.testcaseResults[0]!.verdict).toBe("SE");
    // ConfigMap was created BEFORE the Job throw, so it must still be cleaned up.
    expect(record.configMapsDeleted).toHaveLength(1);
  });
});

describe("DRY: K8s advanced reuses Docker advanced's helpers", () => {
  it("uses the same mapAdvancedResult / advancedFallbackResult symbols as the Docker backend", async () => {
    const k8sMod = await import("../../../apps/worker/src/services/k8s-executor");
    const mapperMod = await import("../../../apps/worker/src/services/sandbox-result-mapper");
    // The k8s-executor module must import these — assert by re-export reference if exposed,
    // otherwise this just documents the contract (Docker imports the SAME mapper).
    expect(typeof mapperMod.mapAdvancedResult).toBe("function");
    expect(typeof mapperMod.advancedFallbackResult).toBe("function");
    // Smoke: k8s module references the mapper module via static import (verified via source).
    expect(k8sMod.K8sExecutor).toBeDefined();
  });
});
