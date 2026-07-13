import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import type { SandboxRequest } from "@nojv/core";
import { describe, expect, it, vi } from "vitest";

import {
  ADVANCED_OUTPUT_MAX_FILES,
  ADVANCED_WORKSPACE_MAX_BYTES,
  safeCopyTree,
} from "../../../apps/worker/src/services/advanced-mode-executor";

import {
  ADVANCED_RESULT_MARKER_BEGIN,
  ADVANCED_RESULT_MARKER_END,
  ADVANCED_SIDECAR_NAME,
  ADVANCED_GRADER_NAME,
  ADVANCED_INIT_NAME,
  ADVANCED_RUN_NAME,
  ADVANCED_TRANSFER_NAME,
  advancedPvcName,
  buildAdvancedConfigMapData,
  buildAdvancedGradeConfigMapData,
  buildAdvancedGradeJobManifest,
  buildAdvancedInitScript,
  buildAdvancedPvcManifest,
  buildAdvancedRunJobManifest,
  buildAdvancedTailScript,
  buildAdvancedTransferScript,
  buildAdvancedTransferWaitScript,
  deriveRunStatusFromJob,
  parseAdvancedResultLog,
} from "../../../apps/worker/src/services/k8s-advanced";
import { K8sExecutor } from "../../../apps/worker/src/services/k8s-executor";

function makeAdvancedRequest(overrides?: {
  imageRef?: string;
  memoryMb?: number;
  totalTimeMs?: number;
  network?: SandboxRequest["advanced"] extends infer A
    ? A extends { network: infer N }
      ? N
      : never
    : never;
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
      run: {
        imageRef: overrides?.imageRef ?? "registry.example.com/ta/run:1.0",
        imageSource: "registry",
      },
      grade: {
        imageRef: overrides?.imageRef ?? "registry.example.com/ta/grade:1.0",
        imageSource: "registry",
      },
      network: overrides?.network ?? { mode: "none" },
      totalTimeMs: overrides?.totalTimeMs ?? 60_000,
      memoryMb: overrides?.memoryMb ?? 512,
      maxScore: 100,
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
  sidecarReadinessTimeoutMs: 50,
  sidecarReadinessIntervalMs: 5,
};

interface CallRecord {
  cleanupEvents: string[];
  configMapsCreated: { name: string; namespace: string; data: Record<string, string> }[];
  configMapsDeleted: { name: string; namespace: string }[];
  pvcsCreated: { name: string; namespace: string; body: unknown }[];
  pvcsDeleted: { name: string; namespace: string }[];
  jobsCreated: { name: string; namespace: string; body: any }[];
  jobsDeleted: { name: string; namespace: string }[];
  podLogsRead: { name: string; namespace: string; container: string }[];
  podsCreated: { name: string; namespace: string; body: any }[];
  podsDeleted: { name: string; namespace: string }[];
  servicesCreated: { name: string; namespace: string; body: any }[];
  servicesDeleted: { name: string; namespace: string }[];
  networkPoliciesCreated: { name: string; namespace: string; body: any }[];
  networkPoliciesDeleted: { name: string; namespace: string }[];
}

interface FakeOpts {
  sidecarLog?: string;
  jobOutcome?: "succeeded" | "failed";
  failJob?: string;
  deadlineExceededJob?: string;
  throwOnJobCreate?: boolean;
  runNodeName?: string | null;
  transferExitCode?: number | null;
  sidecarReadyMarker?: string | null;
  serviceClusterIp?: string | null;
  podWaiting?: { reason: string; message?: string };
  jobPendingPolls?: number;
  jobDeleteError?: Error;
  podDeleteError?: Error;
  residualJobPods?: string[];
  residualPods?: string[];
}

function buildFakeClients(record: CallRecord, opts: FakeOpts = {}) {
  let jobReadCount = 0;
  const jobDeleteAttempts = new Set<string>();
  const podDeleteAttempts = new Set<string>();
  const deletedJobs = new Set<string>();
  const deletedPods = new Set<string>();
  const activeNetworkPolicies = new Set<string>();
  const coreApi = {
    createNamespacedConfigMap: vi.fn(async ({ namespace, body }: any) => {
      record.configMapsCreated.push({ name: body.metadata.name, namespace, data: body.data });
    }),
    deleteNamespacedConfigMap: vi.fn(async ({ name, namespace }: any) => {
      record.configMapsDeleted.push({ name, namespace });
    }),
    createNamespacedPersistentVolumeClaim: vi.fn(async ({ namespace, body }: any) => {
      record.pvcsCreated.push({ name: body.metadata.name, namespace, body });
    }),
    deleteNamespacedPersistentVolumeClaim: vi.fn(async ({ name, namespace }: any) => {
      record.pvcsDeleted.push({ name, namespace });
    }),
    createNamespacedPod: vi.fn(async ({ namespace, body }: any) => {
      record.podsCreated.push({ name: body.metadata.name, namespace, body });
    }),
    deleteNamespacedPod: vi.fn(async ({ name, namespace, propagationPolicy }: any) => {
      record.podsDeleted.push({ name, namespace });
      record.cleanupEvents.push(`delete-pod:${name}:${String(propagationPolicy)}`);
      podDeleteAttempts.add(name);
      if (opts.podDeleteError) throw opts.podDeleteError;
      deletedPods.add(name);
    }),
    createNamespacedService: vi.fn(async ({ namespace, body }: any) => {
      record.servicesCreated.push({ name: body.metadata.name, namespace, body });
      const clusterIP =
        opts.serviceClusterIp === undefined ? "10.96.0.42" : opts.serviceClusterIp;
      return { ...body, spec: { ...body.spec, clusterIP } };
    }),
    deleteNamespacedService: vi.fn(async ({ name, namespace }: any) => {
      record.servicesDeleted.push({ name, namespace });
    }),
    listNamespacedPod: vi.fn(async ({ labelSelector, fieldSelector }: any) => {
      if (fieldSelector) {
        const podName = String(fieldSelector).split("=")[1];
        if (deletedPods.has(podName) || podDeleteAttempts.has(podName)) {
          if (opts.residualPods?.includes(podName)) {
            record.cleanupEvents.push(`observe-pod-present:${podName}`);
            return { items: [{ metadata: { name: podName } }] };
          }
          record.cleanupEvents.push(`confirm-pod-gone:${podName}`);
          return { items: [] };
        }
        return { items: [{ metadata: { name: podName } }] };
      }
      const jobName = String(labelSelector).split("=")[1];
      if (deletedJobs.has(jobName) || jobDeleteAttempts.has(jobName)) {
        if (opts.residualJobPods?.includes(jobName)) {
          record.cleanupEvents.push(`observe-job-pods-present:${jobName}`);
          return { items: [{ metadata: { name: `${jobName}-pod` } }] };
        }
        record.cleanupEvents.push(`confirm-job-pods-gone:${jobName}`);
        return { items: [] };
      }
      const nodeName = opts.runNodeName === undefined ? "node-a" : opts.runNodeName;
      const transferExitCode = opts.transferExitCode === undefined ? 0 : opts.transferExitCode;
      const isRunPod = String(jobName).endsWith("-run");
      const initContainerStatuses =
        isRunPod && transferExitCode !== null
          ? [{ name: "transfer", state: { terminated: { exitCode: transferExitCode } } }]
          : isRunPod
            ? [{ name: "transfer", state: { running: {} } }]
            : undefined;
      const containerStatuses = opts.podWaiting
        ? [
            {
              name: "run",
              state: {
                waiting: {
                  reason: opts.podWaiting.reason,
                  message: opts.podWaiting.message,
                },
              },
            },
          ]
        : undefined;
      return {
        items: [
          {
            metadata: { name: `${jobName}-pod` },
            spec: { nodeName },
            status: { initContainerStatuses, containerStatuses },
          },
        ],
      };
    }),
    readNamespacedPodLog: vi.fn(async ({ name, namespace, container }: any) => {
      record.podLogsRead.push({ name, namespace, container });
      if (String(name).endsWith("-sidecar")) {
        return opts.sidecarReadyMarker === undefined
          ? "NOJV_SERVICE_READY"
          : (opts.sidecarReadyMarker ?? "");
      }
      return opts.sidecarLog ?? "";
    }),
  } as any;

  const batchApi = {
    createNamespacedJob: vi.fn(async ({ namespace, body }: any) => {
      if (opts.throwOnJobCreate) throw new Error("simulated job create failure");
      record.jobsCreated.push({ name: body.metadata.name, namespace, body });
    }),
    deleteNamespacedJob: vi.fn(async ({ name, namespace, propagationPolicy }: any) => {
      record.jobsDeleted.push({ name, namespace });
      record.cleanupEvents.push(`delete-job:${name}:${String(propagationPolicy)}`);
      jobDeleteAttempts.add(name);
      if (opts.jobDeleteError) throw opts.jobDeleteError;
      deletedJobs.add(name);
    }),
    readNamespacedJob: vi.fn(async ({ name }: any) => {
      jobReadCount += 1;
      if (opts.jobPendingPolls && jobReadCount <= opts.jobPendingPolls) {
        return { status: {} };
      }
      const failed =
        (opts.failJob && name === opts.failJob) ||
        (opts.deadlineExceededJob && name === opts.deadlineExceededJob);
      const outcome = failed ? "failed" : (opts.jobOutcome ?? "succeeded");
      const conditions =
        opts.deadlineExceededJob && name === opts.deadlineExceededJob
          ? [{ type: "Failed", reason: "DeadlineExceeded" }]
          : undefined;
      return { status: { [outcome]: 1, conditions } };
    }),
  } as any;

  const networkingApi = {
    createNamespacedNetworkPolicy: vi.fn(async ({ namespace, body }: any) => {
      if (activeNetworkPolicies.has(body.metadata.name)) {
        throw new Error(`409 NetworkPolicy ${body.metadata.name} already exists`);
      }
      activeNetworkPolicies.add(body.metadata.name);
      record.networkPoliciesCreated.push({ name: body.metadata.name, namespace, body });
    }),
    deleteNamespacedNetworkPolicy: vi.fn(async ({ name, namespace }: any) => {
      activeNetworkPolicies.delete(name);
      record.networkPoliciesDeleted.push({ name, namespace });
      record.cleanupEvents.push(`delete-policy:${name}`);
    }),
  } as any;

  return { coreApi, batchApi, networkingApi };
}

function emptyRecord(): CallRecord {
  return {
    cleanupEvents: [],
    configMapsCreated: [],
    configMapsDeleted: [],
    pvcsCreated: [],
    pvcsDeleted: [],
    jobsCreated: [],
    jobsDeleted: [],
    podLogsRead: [],
    podsCreated: [],
    podsDeleted: [],
    servicesCreated: [],
    servicesDeleted: [],
    networkPoliciesCreated: [],
    networkPoliciesDeleted: [],
  };
}

const RUN_PARAMS = {
  jobName: "judge-sub-adv-1-run",
  namespace: "nojv-sandbox",
  configMapName: "judge-sub-adv-1-run-input",
  pvcName: "judge-sub-adv-1-runout",
  sandboxImage: "nojv-sandbox:test",
  runImage: "registry.example.com/ta/run:1.0",
  memoryMb: 512,
  totalTimeMs: 60_000,
  cpuLimit: "1",
  submissionId: "sub-adv-1",
  language: "python",
};

const GRADE_PARAMS = {
  jobName: "judge-sub-adv-1-grade",
  namespace: "nojv-sandbox",
  configMapName: "judge-sub-adv-1-grade-input",
  pvcName: "judge-sub-adv-1-runout",
  sandboxImage: "nojv-sandbox:test",
  gradeImage: "registry.example.com/ta/grade:1.0",
  memoryMb: 512,
  totalTimeMs: 60_000,
  cpuLimit: "1",
  submissionId: "sub-adv-1",
  language: "python",
  nodeName: "node-a",
  egressLabel: "sub-adv-1-grade",
};

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

  it("throws on path-traversal file paths", () => {
    const req = makeAdvancedRequest();
    req.sourceFiles = [
      { path: "../escape.py", content: "evil" },
      { path: "ok.py", content: "good" },
    ];
    expect(() => buildAdvancedConfigMapData(req)).toThrow("Path contains unsafe segments");
  });
});

describe("buildAdvancedGradeConfigMapData", () => {
  it("writes a grade meta.json carrying submissionId, language, runStatus, maxScore (no answers)", () => {
    const data = buildAdvancedGradeConfigMapData(
      "sub-adv-1",
      "python",
      {
        state: "exited",
        exitCode: 0,
      },
      100,
    );
    expect(Object.keys(data)).toEqual(["meta.json"]);
    const meta = JSON.parse(data["meta.json"]!);
    expect(meta).toEqual({
      submissionId: "sub-adv-1",
      language: "python",
      runStatus: { state: "exited", exitCode: 0 },
      maxScore: 100,
    });
  });
});

describe("deriveRunStatusFromJob", () => {
  it("succeeded → exited exit 0", () => {
    expect(deriveRunStatusFromJob("succeeded", false)).toEqual({
      state: "exited",
      exitCode: 0,
    });
  });
  it("failed (non-deadline) → exited exit 1", () => {
    expect(deriveRunStatusFromJob("failed", false)).toEqual({ state: "exited", exitCode: 1 });
  });
  it("deadline exceeded → timed_out regardless of state", () => {
    expect(deriveRunStatusFromJob("failed", true)).toEqual({
      state: "timed_out",
      exitCode: null,
    });
    expect(deriveRunStatusFromJob("succeeded", true)).toEqual({
      state: "timed_out",
      exitCode: null,
    });
  });
});

describe("buildAdvancedInitScript", () => {
  it("creates the workspace layout with output/ chmod 0777 and writes meta + submission files", () => {
    const script = buildAdvancedInitScript();
    expect(script).toContain("/workspace/submission");
    expect(script).toContain("/workspace/output");
    expect(script).toContain("/workspace/meta.json");
    expect(script).toMatch(/chmod\s+0?777\s+\/workspace\/output/);
    expect(script).toContain("/init-payload/payload.json");
  });
});

describe("buildAdvancedTailScript", () => {
  it("contains the result path, marker pair, and a deadline derived from totalTimeMs", () => {
    const script = buildAdvancedTailScript(60_000);
    expect(script).toContain("/workspace/output/result.json");
    expect(script).toContain(ADVANCED_RESULT_MARKER_BEGIN);
    expect(script).toContain(ADVANCED_RESULT_MARKER_END);
    expect(script).toContain("90");
    expect(script).toContain('{"missing":true}');
  });
});

describe("buildAdvancedTransferScript (the safe-copy gate)", () => {
  it("embeds the skip-symlink / skip-special / file+byte cap gate", () => {
    const script = buildAdvancedTransferScript();
    expect(script).toContain("lstatSync");
    expect(script).toContain("isSymbolicLink");
    expect(script).toContain("isDirectory");
    expect(script).toContain("isFile");
    expect(script).toContain("copyFileSync");
    expect(script).toContain("NOJV_TRANSFER_FILE_CAP");
    expect(script).toContain("NOJV_TRANSFER_BYTE_CAP");
  });

  it("the wait wrapper copies into the PVC mount on TERM and passes the caps", () => {
    const script = buildAdvancedTransferWaitScript();
    expect(script).toContain("trap copy TERM INT");
    expect(script).toContain("/run-output");
    expect(script).toContain("NOJV_TRANSFER_MAX_FILES=100000");
    expect(script).toContain("NOJV_TRANSFER_MAX_BYTES=1073741824");
  });
});

describe("safe-copy gate executed against a real tree (binary-safe, drops symlinks/special files)", () => {
  function runGate(src: string, dest: string, env: Record<string, string> = {}): void {
    execFileSync(process.execPath, ["-e", buildAdvancedTransferScript()], {
      env: {
        ...process.env,
        NOJV_TRANSFER_SRC: src,
        NOJV_TRANSFER_DEST: dest,
        NOJV_TRANSFER_MAX_FILES: "100000",
        NOJV_TRANSFER_MAX_BYTES: "1073741824",
        ...env,
      },
    });
  }

  it("copies regular files (binary-safe), recurses dirs, and DROPS a symlink to a secret", () => {
    const root = mkdtempSync(join(tmpdir(), "nojv-gate-"));
    const src = join(root, "output");
    const dest = join(root, "pvc");
    const secret = join(root, "answers");
    mkdirSync(src, { recursive: true });
    mkdirSync(join(src, "sub"), { recursive: true });
    mkdirSync(secret, { recursive: true });
    writeFileSync(join(secret, "key.txt"), "TOP-SECRET-ANSWER");
    writeFileSync(join(src, "a.bin"), Buffer.from([0x00, 0xff, 0x10, 0x80, 0x00]));
    writeFileSync(join(src, "sub", "b.txt"), "hello");
    symlinkSync(join(secret, "key.txt"), join(src, "leak"));
    symlinkSync("../escape", join(src, "rel-leak"));

    runGate(src, dest);

    const top = readdirSync(dest);
    expect(top.sort()).toEqual(["a.bin", "sub"]);
    expect(readdirSync(join(dest, "sub"))).toEqual(["b.txt"]);
    expect(readdirSync(dest)).not.toContain("leak");
    expect(readdirSync(dest)).not.toContain("rel-leak");
  });

  it("DROPS special files (FIFO) without hanging", () => {
    const root = mkdtempSync(join(tmpdir(), "nojv-gate-fifo-"));
    const src = join(root, "output");
    const dest = join(root, "pvc");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "ok.txt"), "ok");
    try {
      execFileSync("mkfifo", [join(src, "pipe")]);
    } catch {
      return;
    }

    runGate(src, dest);
    expect(readdirSync(dest)).toEqual(["ok.txt"]);
  });

  it("throws (→ SE) when the file-count cap is exceeded", () => {
    const root = mkdtempSync(join(tmpdir(), "nojv-gate-cap-"));
    const src = join(root, "output");
    const dest = join(root, "pvc");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "a"), "1");
    writeFileSync(join(src, "b"), "2");
    expect(() => runGate(src, dest, { NOJV_TRANSFER_MAX_FILES: "1" })).toThrow();
  });

  it("throws (→ SE) when the byte cap is exceeded", () => {
    const root = mkdtempSync(join(tmpdir(), "nojv-gate-bytecap-"));
    const src = join(root, "output");
    const dest = join(root, "pvc");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "big"), "x".repeat(100));
    expect(() => runGate(src, dest, { NOJV_TRANSFER_MAX_BYTES: "10" })).toThrow();
  });
});

function snapshotTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out[relative(dir, full)] = readFileSync(full).toString("base64");
      }
    }
  };
  walk(dir);
  return out;
}

function buildAdversarialFixture(root: string): string {
  const src = join(root, "output");
  const secret = join(root, "answers");
  mkdirSync(join(src, "nested", "deep"), { recursive: true });
  mkdirSync(secret, { recursive: true });
  writeFileSync(join(secret, "key.txt"), "TOP-SECRET-ANSWER");
  writeFileSync(join(src, "img.bin"), Buffer.from([0x00, 0xff, 0x10, 0x80, 0x00, 0x7f]));
  writeFileSync(join(src, "nested", "note.txt"), "plain text");
  writeFileSync(join(src, "nested", "deep", "leaf.dat"), Buffer.from([0x01, 0x02, 0x03]));
  symlinkSync(join(secret, "key.txt"), join(src, "abs-leak"));
  symlinkSync("../escape", join(src, "rel-leak"));
  try {
    execFileSync("mkfifo", [join(src, "pipe")]);
  } catch {}
  return src;
}

describe("cross-gate parity: Docker safeCopyTree and the K8s embedded gate sanitize identically", () => {
  it("produces byte-identical sanitized trees from the same adversarial fixture", async () => {
    const root = mkdtempSync(join(tmpdir(), "nojv-gate-parity-"));
    const src = buildAdversarialFixture(root);

    const dockerDest = join(root, "docker-dest");
    await safeCopyTree(src, dockerDest, {
      maxFiles: ADVANCED_OUTPUT_MAX_FILES,
      maxBytes: ADVANCED_WORKSPACE_MAX_BYTES,
    });

    const k8sDest = join(root, "k8s-dest");
    execFileSync(process.execPath, ["-e", buildAdvancedTransferScript()], {
      env: {
        ...process.env,
        NOJV_TRANSFER_SRC: src,
        NOJV_TRANSFER_DEST: k8sDest,
        NOJV_TRANSFER_MAX_FILES: String(ADVANCED_OUTPUT_MAX_FILES),
        NOJV_TRANSFER_MAX_BYTES: String(ADVANCED_WORKSPACE_MAX_BYTES),
      },
    });

    const dockerSnap = snapshotTree(dockerDest);
    const k8sSnap = snapshotTree(k8sDest);

    expect(k8sSnap).toEqual(dockerSnap);
    expect(Object.keys(dockerSnap).sort()).toEqual([
      "img.bin",
      join("nested", "deep", "leaf.dat"),
      join("nested", "note.txt"),
    ]);
    expect(Object.keys(dockerSnap).some((k) => k.includes("leak"))).toBe(false);
    expect(Object.keys(dockerSnap).some((k) => k.includes("pipe"))).toBe(false);
  });

  it("both gates reject the same at-cap fixture", async () => {
    const root = mkdtempSync(join(tmpdir(), "nojv-gate-parity-cap-"));
    const src = join(root, "output");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "a"), "1");
    writeFileSync(join(src, "b"), "2");

    await expect(
      safeCopyTree(src, join(root, "docker-dest"), { maxFiles: 1, maxBytes: 1_000_000 }),
    ).rejects.toThrow();

    expect(() =>
      execFileSync(process.execPath, ["-e", buildAdvancedTransferScript()], {
        env: {
          ...process.env,
          NOJV_TRANSFER_SRC: src,
          NOJV_TRANSFER_DEST: join(root, "k8s-dest"),
          NOJV_TRANSFER_MAX_FILES: "1",
          NOJV_TRANSFER_MAX_BYTES: "1000000",
        },
      }),
    ).toThrow();
  });
});

describe("parseAdvancedResultLog", () => {
  it("extracts and JSON-parses a clean marker block", () => {
    const json = '{"score":80,"verdict":"accepted","feedback":"ok"}';
    const log = `noise\n${ADVANCED_RESULT_MARKER_BEGIN}\n${json}\n${ADVANCED_RESULT_MARKER_END}\nmore noise\n`;
    expect(parseAdvancedResultLog(log)).toEqual({
      score: 80,
      verdict: "accepted",
      feedback: "ok",
    });
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
});

describe("buildAdvancedPvcManifest", () => {
  it("is a per-submission ReadWriteOnce PVC", () => {
    const pvc = buildAdvancedPvcManifest({
      pvcName: advancedPvcName("sub-adv-1"),
      namespace: "nojv-sandbox",
    });
    expect(pvc.metadata!.name).toBe("judge-sub-adv-1-runout");
    expect(pvc.spec!.accessModes).toEqual(["ReadWriteOnce"]);
    expect(pvc.spec!.resources!.requests!.storage).toBeTruthy();
  });
});

describe("buildAdvancedRunJobManifest — untrusted run Pod", () => {
  it("has the RUN image as its single main container", () => {
    const m = buildAdvancedRunJobManifest(RUN_PARAMS);
    const podSpec = m.spec!.template.spec!;
    expect(podSpec.containers.length).toBe(1);
    expect(podSpec.containers[0]!.name).toBe(ADVANCED_RUN_NAME);
    expect(podSpec.containers[0]!.image).toBe("registry.example.com/ta/run:1.0");
  });

  it("does NOT override the run image entrypoint (no injected command)", () => {
    const m = buildAdvancedRunJobManifest(RUN_PARAMS);
    expect(m.spec!.template.spec!.containers[0]!.command).toBeUndefined();
  });

  it("has prep + transfer initContainers; transfer is a native sidecar (restartPolicy Always)", () => {
    const m = buildAdvancedRunJobManifest(RUN_PARAMS);
    const inits = m.spec!.template.spec!.initContainers!;
    const names = inits.map((c) => c.name).sort();
    expect(names).toEqual([ADVANCED_INIT_NAME, ADVANCED_TRANSFER_NAME].sort());
    const transfer = inits.find((c) => c.name === ADVANCED_TRANSFER_NAME)!;
    expect(transfer.restartPolicy).toBe("Always");
    expect(transfer.image).toBe("nojv-sandbox:test");
    expect(JSON.stringify(transfer.command)).toContain("trap copy TERM");
  });

  it("the transfer sidecar mounts BOTH the workspace and the PVC (so it can copy output→PVC)", () => {
    const m = buildAdvancedRunJobManifest(RUN_PARAMS);
    const transfer = m.spec!.template.spec!.initContainers!.find(
      (c) => c.name === ADVANCED_TRANSFER_NAME,
    )!;
    const mounts = transfer.volumeMounts!.map((v) => v.mountPath).sort();
    expect(mounts).toContain("/workspace");
    expect(mounts).toContain("/run-output");
  });

  it("the run container does NOT mount the PVC (only platform code touches the PVC)", () => {
    const m = buildAdvancedRunJobManifest(RUN_PARAMS);
    const run = m.spec!.template.spec!.containers[0]!;
    expect(run.volumeMounts!.some((v) => v.name === "run-output")).toBe(false);
  });

  it("mounts the per-submission PVC as a volume", () => {
    const m = buildAdvancedRunJobManifest(RUN_PARAMS);
    const vol = m.spec!.template.spec!.volumes!.find((v) => v.name === "run-output");
    expect(vol!.persistentVolumeClaim!.claimName).toBe("judge-sub-adv-1-runout");
  });

  it("hardens the run container: runAsUser 10001, cap-drop ALL, read-only rootfs, seccomp, mem/cpu limits", () => {
    const m = buildAdvancedRunJobManifest(RUN_PARAMS);
    const podSpec = m.spec!.template.spec!;
    expect(podSpec.securityContext).toMatchObject({
      runAsUser: 10001,
      runAsNonRoot: true,
      seccompProfile: { type: "RuntimeDefault" },
    });
    const run = podSpec.containers[0]!;
    expect(run.securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
      readOnlyRootFilesystem: true,
      runAsUser: 10001,
    });
    expect(run.resources!.limits!.memory).toBe("512Mi");
    expect(run.resources!.limits!.cpu).toBe("1");
  });

  it("pins to the sandbox node pool and never auto-mounts a service-account token", () => {
    const m = buildAdvancedRunJobManifest(RUN_PARAMS);
    const podSpec = m.spec!.template.spec!;
    expect(podSpec.automountServiceAccountToken).toBe(false);
    expect(podSpec.nodeSelector).toEqual({ "nojv-role": "sandbox" });
    expect(podSpec.tolerations).toEqual([
      { key: "nojv-role", operator: "Equal", value: "sandbox", effect: "NoSchedule" },
    ]);
    expect(podSpec.restartPolicy).toBe("Never");
    expect(m.spec!.backoffLimit).toBe(0);
    expect(m.spec!.activeDeadlineSeconds).toBe(90);
  });

  it("carries imagePullSecrets when an imagePullSecretName is supplied", () => {
    const m = buildAdvancedRunJobManifest({
      ...RUN_PARAMS,
      imagePullSecretName: "nojv-registry-pull",
    });
    expect(m.spec!.template.spec!.imagePullSecrets).toEqual([{ name: "nojv-registry-pull" }]);
  });

  it("omits imagePullSecrets when no imagePullSecretName is supplied", () => {
    const m = buildAdvancedRunJobManifest(RUN_PARAMS);
    expect(m.spec!.template.spec!.imagePullSecrets).toBeUndefined();
  });
});

describe("buildAdvancedGradeJobManifest — trusted grade Pod, no student code", () => {
  it("has the GRADE image as its single main container and NO run/student container", () => {
    const m = buildAdvancedGradeJobManifest(GRADE_PARAMS);
    const podSpec = m.spec!.template.spec!;
    expect(podSpec.containers.length).toBe(1);
    expect(podSpec.containers[0]!.name).toBe(ADVANCED_GRADER_NAME);
    expect(podSpec.containers[0]!.image).toBe("registry.example.com/ta/grade:1.0");
    expect(podSpec.containers.some((c) => c.name === ADVANCED_RUN_NAME)).toBe(false);
    expect((podSpec.initContainers ?? []).some((c) => c.name === ADVANCED_RUN_NAME)).toBe(
      false,
    );
  });

  it("mounts the PVC READ-ONLY at /workspace/run-output into the grader", () => {
    const m = buildAdvancedGradeJobManifest(GRADE_PARAMS);
    const grader = m.spec!.template.spec!.containers[0]!;
    const mount = grader.volumeMounts!.find((v) => v.name === "run-output")!;
    expect(mount.mountPath).toBe("/workspace/run-output");
    expect(mount.readOnly).toBe(true);
    const vol = m.spec!.template.spec!.volumes!.find((v) => v.name === "run-output");
    expect(vol!.persistentVolumeClaim).toMatchObject({
      claimName: "judge-sub-adv-1-runout",
      readOnly: true,
    });
  });

  it("has the emit-result sidecar tailing result.json between the markers", () => {
    const m = buildAdvancedGradeJobManifest(GRADE_PARAMS);
    const sidecar = m.spec!.template.spec!.initContainers!.find(
      (c) => c.name === ADVANCED_SIDECAR_NAME,
    )!;
    expect(sidecar.restartPolicy).toBe("Always");
    expect(JSON.stringify(sidecar.command)).toContain(ADVANCED_RESULT_MARKER_BEGIN);
  });

  it("is pinned to the same node as the run Pod", () => {
    const m = buildAdvancedGradeJobManifest(GRADE_PARAMS);
    expect(m.spec!.template.spec!.nodeName).toBe("node-a");
  });

  it("grade init seeds meta.json from the grade ConfigMap, not from the PVC", () => {
    const m = buildAdvancedGradeJobManifest(GRADE_PARAMS);
    const init = m.spec!.template.spec!.initContainers!.find(
      (c) => c.name === ADVANCED_INIT_NAME,
    )!;
    expect(JSON.stringify(init.command)).toContain("/grade-meta/meta.json");
    const vol = m.spec!.template.spec!.volumes!.find((v) => v.name === "grade-meta");
    expect(vol!.configMap!.name).toBe("judge-sub-adv-1-grade-input");
  });

  it("pins the grader non-root (runAsUser 10001, cap-drop ALL) and carries the grade egress label", () => {
    const m = buildAdvancedGradeJobManifest(GRADE_PARAMS);
    const podSpec = m.spec!.template.spec!;
    expect(podSpec.securityContext).toMatchObject({
      runAsUser: 10001,
      runAsNonRoot: true,
      seccompProfile: { type: "RuntimeDefault" },
    });
    const grader = podSpec.containers[0]!;
    expect(grader.securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
      readOnlyRootFilesystem: true,
      runAsUser: 10001,
    });
    expect(m.spec!.template.metadata!.labels!["nojv.egress"]).toBe("sub-adv-1-grade");
  });

  it("carries imagePullSecrets when an imagePullSecretName is supplied", () => {
    const m = buildAdvancedGradeJobManifest({
      ...GRADE_PARAMS,
      imagePullSecretName: "nojv-registry-pull",
    });
    expect(m.spec!.template.spec!.imagePullSecrets).toEqual([{ name: "nojv-registry-pull" }]);
  });

  it("omits imagePullSecrets when no imagePullSecretName is supplied", () => {
    const m = buildAdvancedGradeJobManifest(GRADE_PARAMS);
    expect(m.spec!.template.spec!.imagePullSecrets).toBeUndefined();
  });
});

function buildSidecarLog(payload: Record<string, unknown>): string {
  return [
    "prep ok",
    ADVANCED_RESULT_MARKER_BEGIN,
    JSON.stringify(payload),
    ADVANCED_RESULT_MARKER_END,
    "",
  ].join("\n");
}

describe("K8sExecutor.execute(advanced) — registry source two-Job/PVC orchestration", () => {
  it("creates PVC → run Job → grade Job (same node) → reads grade sidecar → AC result", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({
      score: 100,
      verdict: "accepted",
      feedback: "all good",
    });
    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { sidecarLog }));
    const result = await executor.execute(makeAdvancedRequest());

    expect(record.pvcsCreated).toHaveLength(1);
    expect(record.pvcsCreated[0]!.name).toBe("judge-sub-adv-1-runout");
    expect(record.jobsCreated.map((j) => j.name)).toEqual([
      "judge-sub-adv-1-run",
      "judge-sub-adv-1-grade",
    ]);

    const gradeJob = record.jobsCreated.find((j) => j.name === "judge-sub-adv-1-grade")!;
    expect(gradeJob.body.spec.template.spec.nodeName).toBe("node-a");

    expect(record.configMapsCreated.map((c) => c.name).sort()).toEqual([
      "judge-sub-adv-1-grade-input",
      "judge-sub-adv-1-run-input",
    ]);
    const gradeCm = record.configMapsCreated.find(
      (c) => c.name === "judge-sub-adv-1-grade-input",
    )!;
    const gradeMeta = JSON.parse(gradeCm.data["meta.json"]!);
    expect(gradeMeta.runStatus).toEqual({ state: "exited", exitCode: 0 });

    expect(record.podLogsRead.some((c) => c.container === ADVANCED_SIDECAR_NAME)).toBe(true);
    expect(result.testcaseResults[0]!.verdict).toBe("AC");
    expect(result.customScore).toBe(100);
  });

  it("a failed run Job still proceeds to grade, conveying runStatus exit 1", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ score: 0, verdict: "runtime_error" });
    const executor = new K8sExecutor(
      EXEC_CONFIG,
      buildFakeClients(record, { sidecarLog, failJob: "judge-sub-adv-1-run" }),
    );
    const result = await executor.execute(makeAdvancedRequest());

    expect(record.jobsCreated.map((j) => j.name)).toContain("judge-sub-adv-1-grade");
    const gradeCm = record.configMapsCreated.find(
      (c) => c.name === "judge-sub-adv-1-grade-input",
    )!;
    expect(JSON.parse(gradeCm.data["meta.json"]!).runStatus).toEqual({
      state: "exited",
      exitCode: 1,
    });
    expect(result.testcaseResults[0]!.verdict).toBe("RE");
  });

  it("run Pod with no scheduled node (PVC/scheduling failure) → SE, grade never created", async () => {
    const record = emptyRecord();
    const executor = new K8sExecutor(
      EXEC_CONFIG,
      buildFakeClients(record, { runNodeName: null }),
    );
    const result = await executor.execute(makeAdvancedRequest());

    expect(result.testcaseResults[0]!.verdict).toBe("SE");
    expect(record.jobsCreated.map((j) => j.name)).toEqual(["judge-sub-adv-1-run"]);
    expect(record.jobsCreated.some((j) => j.name === "judge-sub-adv-1-grade")).toBe(false);
  });

  it("transfer sidecar exited non-zero (cap/IO capture failure) → SE, grade never created", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ score: 100, verdict: "accepted" });
    const executor = new K8sExecutor(
      EXEC_CONFIG,
      buildFakeClients(record, { sidecarLog, transferExitCode: 1 }),
    );
    const result = await executor.execute(makeAdvancedRequest());

    expect(result.testcaseResults[0]!.verdict).toBe("SE");
    const message = result.testcaseResults[0]!.feedback ?? result.testcaseResults[0]!.stderr;
    expect(message).toMatch(/capture failed/i);
    expect(record.jobsCreated.map((j) => j.name)).toEqual(["judge-sub-adv-1-run"]);
    expect(record.jobsCreated.some((j) => j.name === "judge-sub-adv-1-grade")).toBe(false);
    expect(record.pvcsDeleted).toHaveLength(1);
  });

  it("transfer sidecar never terminated cleanly (no terminated state) → SE", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ score: 100, verdict: "accepted" });
    const executor = new K8sExecutor(
      EXEC_CONFIG,
      buildFakeClients(record, { sidecarLog, transferExitCode: null }),
    );
    const result = await executor.execute(makeAdvancedRequest());

    expect(result.testcaseResults[0]!.verdict).toBe("SE");
    expect(record.jobsCreated.some((j) => j.name === "judge-sub-adv-1-grade")).toBe(false);
  });

  it("deadline-exceeded run still proceeds to grade even though transfer didn't terminate cleanly", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ score: 0, verdict: "time_limit_exceeded" });
    const executor = new K8sExecutor(
      EXEC_CONFIG,
      buildFakeClients(record, {
        sidecarLog,
        failJob: "judge-sub-adv-1-run",
        deadlineExceededJob: "judge-sub-adv-1-run",
        transferExitCode: null,
      }),
    );
    const result = await executor.execute(makeAdvancedRequest());

    expect(record.jobsCreated.map((j) => j.name)).toContain("judge-sub-adv-1-grade");
    const gradeCm = record.configMapsCreated.find(
      (c) => c.name === "judge-sub-adv-1-grade-input",
    )!;
    expect(JSON.parse(gradeCm.data["meta.json"]!).runStatus).toEqual({
      state: "timed_out",
      exitCode: null,
    });
    expect(result.testcaseResults[0]!.verdict).toBe("TLE");
  });

  it("missing result.json (grade sidecar emits {missing:true}) → SE", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ missing: true });
    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { sidecarLog }));
    const result = await executor.execute(makeAdvancedRequest());
    expect(result.testcaseResults[0]!.verdict).toBe("SE");
    const message = result.testcaseResults[0]!.feedback ?? result.testcaseResults[0]!.stderr;
    expect(message).toMatch(/result\.json/i);
  });

  it("invalid result.json → SE", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ score: "nope", verdict: "accepted" });
    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { sidecarLog }));
    const result = await executor.execute(makeAdvancedRequest());
    expect(result.testcaseResults[0]!.verdict).toBe("SE");
  });

  it("teardown deletes both Jobs, both ConfigMaps, and the PVC even on success", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ score: 100, verdict: "accepted" });
    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { sidecarLog }));
    await executor.execute(makeAdvancedRequest());

    expect(record.jobsDeleted.map((j) => j.name).sort()).toEqual([
      "judge-sub-adv-1-grade",
      "judge-sub-adv-1-run",
    ]);
    expect(record.configMapsDeleted.map((c) => c.name).sort()).toEqual([
      "judge-sub-adv-1-grade-input",
      "judge-sub-adv-1-run-input",
    ]);
    expect(record.pvcsDeleted.map((p) => p.name)).toEqual(["judge-sub-adv-1-runout"]);
  });

  it("mode=none: run Pod carries NO nojv.egress label and no proxy/service env (deny-all)", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ score: 100, verdict: "accepted" });
    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { sidecarLog }));
    await executor.execute(makeAdvancedRequest());

    const runJob = record.jobsCreated.find((j) => j.name === "judge-sub-adv-1-run")!;
    const runLabels = runJob.body.spec.template.metadata.labels;
    expect(runLabels["nojv.egress"]).toBeUndefined();
    const runEnv = runJob.body.spec.template.spec.containers[0].env.map((e: any) => e.name);
    expect(runEnv).not.toContain("HTTP_PROXY");
    expect(runEnv).not.toContain("NOJV_SERVICE_HOST");

    expect(record.podsCreated).toHaveLength(0);
    expect(record.servicesCreated).toHaveLength(0);
  });

  it("mode=none: grade Pod STILL escapes deny-all and gets its own grade-egress policy", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ score: 100, verdict: "accepted" });
    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { sidecarLog }));
    await executor.execute(makeAdvancedRequest());

    const gradeJob = record.jobsCreated.find((j) => j.name === "judge-sub-adv-1-grade")!;
    expect(gradeJob.body.spec.template.metadata.labels["nojv.egress"]).toBe("sub-adv-1-grade");

    expect(record.networkPoliciesCreated.map((p) => p.name)).toEqual([
      "judge-sub-adv-1-grade-egress",
    ]);
    expect(record.networkPoliciesDeleted.map((p) => p.name)).toEqual([
      "judge-sub-adv-1-grade-egress",
    ]);
  });

  it("mode=service: starts the TA service Pod+Service, injects NOJV_SERVICE_HOST (no HTTP_PROXY)", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ score: 100, verdict: "accepted" });
    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { sidecarLog }));
    await executor.execute(
      makeAdvancedRequest({
        network: {
          mode: "service",
          service: { imageRef: "registry.example.com/ta/svc:1.0", imageSource: "registry" },
        },
      }),
    );

    const svcPod = record.podsCreated.find((p) => p.name === "judge-sub-adv-1-sidecar")!;
    expect(svcPod.body.spec.containers[0].image).toBe("registry.example.com/ta/svc:1.0");
    const svcEnv = Object.fromEntries(
      svcPod.body.spec.containers[0].env.map((e: any) => [e.name, e.value]),
    );
    expect(svcEnv.PORT).toBe("8888");

    const runJob = record.jobsCreated.find((j) => j.name === "judge-sub-adv-1-run")!;
    expect(runJob.body.spec.template.metadata.labels["nojv.egress"]).toBe("sub-adv-1");
    const runEnv = Object.fromEntries(
      runJob.body.spec.template.spec.containers[0].env.map((e: any) => [e.name, e.value]),
    );
    expect(runEnv.NOJV_SERVICE_HOST).toBe("10.96.0.42:8888");
    expect(runEnv.NOJV_SERVICE_HOST).not.toContain("sidecar");
    expect(runEnv.HTTP_PROXY).toBeUndefined();

    expect(record.networkPoliciesCreated.map((p) => p.name).sort()).toEqual([
      "judge-sub-adv-1-grade-egress",
      "judge-sub-adv-1-run-egress",
      "judge-sub-adv-1-sidecar-egress",
    ]);
  });

  it("SECURITY: keeps advanced policies until their selected Pods are confirmed gone", async () => {
    const record = emptyRecord();
    const executor = new K8sExecutor(
      EXEC_CONFIG,
      buildFakeClients(record, {
        sidecarLog: buildSidecarLog({ score: 100, verdict: "accepted" }),
      }),
    );
    await executor.execute(
      makeAdvancedRequest({
        network: {
          mode: "service",
          service: { imageRef: "registry.example.com/ta/svc:1.0", imageSource: "registry" },
        },
      }),
    );

    const before = (earlier: string, later: string) => {
      expect(record.cleanupEvents.indexOf(earlier), earlier).toBeGreaterThanOrEqual(0);
      expect(record.cleanupEvents.indexOf(later), later).toBeGreaterThan(
        record.cleanupEvents.indexOf(earlier),
      );
    };

    before(
      "delete-job:judge-sub-adv-1-run:Foreground",
      "confirm-job-pods-gone:judge-sub-adv-1-run",
    );
    before(
      "confirm-job-pods-gone:judge-sub-adv-1-run",
      "delete-policy:judge-sub-adv-1-run-egress",
    );
    before(
      "delete-job:judge-sub-adv-1-grade:Foreground",
      "confirm-job-pods-gone:judge-sub-adv-1-grade",
    );
    before(
      "confirm-job-pods-gone:judge-sub-adv-1-grade",
      "delete-policy:judge-sub-adv-1-grade-egress",
    );
    before(
      "delete-pod:judge-sub-adv-1-sidecar:Foreground",
      "confirm-pod-gone:judge-sub-adv-1-sidecar",
    );
    before(
      "confirm-pod-gone:judge-sub-adv-1-sidecar",
      "delete-policy:judge-sub-adv-1-sidecar-egress",
    );
  });

  it("404 deleting Jobs that were never created still confirms no Pods, removes policy, and permits retry", async () => {
    const record = emptyRecord();
    const executor = new K8sExecutor(
      EXEC_CONFIG,
      buildFakeClients(record, {
        throwOnJobCreate: true,
        jobDeleteError: new Error("404 Job not found"),
      }),
    );

    await expect(executor.execute(makeAdvancedRequest())).rejects.toThrow(
      "simulated job create failure",
    );
    await expect(executor.execute(makeAdvancedRequest())).rejects.toThrow(
      "simulated job create failure",
    );

    expect(record.cleanupEvents).toContain("confirm-job-pods-gone:judge-sub-adv-1-grade");
    expect(record.networkPoliciesDeleted.map((policy) => policy.name)).toEqual([
      "judge-sub-adv-1-grade-egress",
      "judge-sub-adv-1-grade-egress",
    ]);
  });

  it("DELETE errors still poll selectors and retain policies while Job or sidecar Pods remain", async () => {
    vi.useFakeTimers();
    try {
      const record = emptyRecord();
      const executor = new K8sExecutor(
        EXEC_CONFIG,
        buildFakeClients(record, {
          sidecarLog: buildSidecarLog({ score: 100, verdict: "accepted" }),
          jobDeleteError: new Error("job delete transport failure"),
          podDeleteError: new Error("pod delete transport failure"),
          residualJobPods: ["judge-sub-adv-1-grade"],
          residualPods: ["judge-sub-adv-1-sidecar"],
        }),
      );

      const execution = executor.execute(
        makeAdvancedRequest({
          network: {
            mode: "service",
            service: { imageRef: "registry.example.com/ta/svc:1.0", imageSource: "registry" },
          },
        }),
      );
      await vi.runAllTimersAsync();
      await execution;

      expect(record.cleanupEvents).toContain("observe-job-pods-present:judge-sub-adv-1-grade");
      expect(record.cleanupEvents).toContain("observe-pod-present:judge-sub-adv-1-sidecar");
      expect(record.networkPoliciesDeleted.map((policy) => policy.name)).not.toContain(
        "judge-sub-adv-1-grade-egress",
      );
      expect(record.networkPoliciesDeleted.map((policy) => policy.name)).not.toContain(
        "judge-sub-adv-1-sidecar-egress",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("mode=service: missing service marker fails closed before the run starts", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ score: 100, verdict: "accepted" });
    const executor = new K8sExecutor(
      EXEC_CONFIG,
      buildFakeClients(record, { sidecarLog, sidecarReadyMarker: "" }),
    );
    const result = await executor.execute(
      makeAdvancedRequest({
        network: {
          mode: "service",
          service: { imageRef: "registry.example.com/ta/svc:1.0", imageSource: "registry" },
        },
      }),
    );

    expect(result.testcaseResults[0]!.verdict).toBe("SE");
    expect(record.jobsCreated.map((j) => j.name)).not.toContain("judge-sub-adv-1-run");
  });

  it("Job creation failure → rethrows for Temporal retry, cleanup (incl. PVC) still runs in finally", async () => {
    const record = emptyRecord();
    const executor = new K8sExecutor(
      EXEC_CONFIG,
      buildFakeClients(record, { throwOnJobCreate: true }),
    );
    await expect(executor.execute(makeAdvancedRequest())).rejects.toThrow(
      "simulated job create failure",
    );
    expect(record.pvcsDeleted).toHaveLength(1);
    expect(record.configMapsDeleted.some((c) => c.name === "judge-sub-adv-1-run-input")).toBe(
      true,
    );
  });

  it("imagePullSecretName in config threads onto both Jobs and the service-mode sidecar Pod", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ score: 100, verdict: "accepted" });
    const executor = new K8sExecutor(
      { ...EXEC_CONFIG, imagePullSecretName: "nojv-registry-pull" },
      buildFakeClients(record, { sidecarLog }),
    );
    await executor.execute(
      makeAdvancedRequest({
        network: {
          mode: "service",
          service: { imageRef: "registry.example.com/ta/svc:1.0", imageSource: "registry" },
        },
      }),
    );

    const runJob = record.jobsCreated.find((j) => j.name === "judge-sub-adv-1-run")!;
    expect(runJob.body.spec.template.spec.imagePullSecrets).toEqual([
      { name: "nojv-registry-pull" },
    ]);
    const gradeJob = record.jobsCreated.find((j) => j.name === "judge-sub-adv-1-grade")!;
    expect(gradeJob.body.spec.template.spec.imagePullSecrets).toEqual([
      { name: "nojv-registry-pull" },
    ]);

    const svcPod = record.podsCreated.find((p) => p.name === "judge-sub-adv-1-sidecar")!;
    expect(svcPod.body.spec.imagePullSecrets).toEqual([{ name: "nojv-registry-pull" }]);
  });

  it("without imagePullSecretName the created Jobs carry no imagePullSecrets", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ score: 100, verdict: "accepted" });
    const executor = new K8sExecutor(EXEC_CONFIG, buildFakeClients(record, { sidecarLog }));
    await executor.execute(makeAdvancedRequest());

    for (const job of record.jobsCreated) {
      expect(job.body.spec.template.spec.imagePullSecrets).toBeUndefined();
    }
  });
});

describe("K8sExecutor.execute(advanced) — image pull failures", () => {
  it("ImagePullBackOff is terminal: resolves to SE carrying the pull message, no grade Job, no retry", async () => {
    const record = emptyRecord();
    const executor = new K8sExecutor(
      EXEC_CONFIG,
      buildFakeClients(record, {
        jobPendingPolls: 5,
        podWaiting: {
          reason: "ImagePullBackOff",
          message: "Back-off pulling image ghcr.io/x/y@sha256:deadbeef",
        },
      }),
    );

    const result = await executor.execute(makeAdvancedRequest());

    expect(result.testcaseResults.every((t) => t.verdict === "SE")).toBe(true);
    expect(result.scoringFeedback).toContain(
      "Back-off pulling image ghcr.io/x/y@sha256:deadbeef",
    );
    expect(record.jobsCreated.map((j) => j.name)).toEqual(["judge-sub-adv-1-run"]);
    expect(record.jobsCreated.some((j) => j.name === "judge-sub-adv-1-grade")).toBe(false);
  });

  it("ErrImagePull alone is transient: does NOT terminate, keeps polling until the Job resolves", async () => {
    const record = emptyRecord();
    const sidecarLog = buildSidecarLog({ score: 100, verdict: "accepted" });
    const executor = new K8sExecutor(
      EXEC_CONFIG,
      buildFakeClients(record, {
        sidecarLog,
        jobPendingPolls: 1,
        podWaiting: {
          reason: "ErrImagePull",
          message: "pull access denied (transient registry blip)",
        },
      }),
    );

    const result = await executor.execute(makeAdvancedRequest());

    expect(result.testcaseResults[0]!.verdict).toBe("AC");
    expect(record.jobsCreated.map((j) => j.name)).toContain("judge-sub-adv-1-run");
    expect(record.jobsCreated.map((j) => j.name)).toContain("judge-sub-adv-1-grade");
  });
});

describe("DRY: K8s advanced reuses Docker advanced's helpers", () => {
  it("uses the same mapAdvancedResult / advancedFallbackResult symbols as the Docker backend", async () => {
    const mapperMod = await import("../../../apps/worker/src/services/sandbox-result-mapper");
    expect(typeof mapperMod.mapAdvancedResult).toBe("function");
    expect(typeof mapperMod.advancedFallbackResult).toBe("function");
  });
});
