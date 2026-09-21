import type * as k8s from "@kubernetes/client-node";
import type { RawCaseRun, SandboxRequest } from "@nojv/core";
import { describe, expect, it, vi } from "vitest";

import {
  K8sExecutor,
  type K8sClientHandles,
  type PreparedArtifactReference,
} from "../../../apps/worker/src/services/k8s-executor";
import type { SandboxPayloadManifest } from "../../../apps/worker/src/services/k8s-payload";

const RUN_ID = "a1000000-0000-4000-8000-000000000001";
const OTHER_RUN_ID = "a1000000-0000-4000-8000-000000000002";
const CONFIG = {
  namespace: "nojv-sandbox",
  image: "sandbox@sha256:test",
  cpuRequest: "1",
  cpuLimit: "1",
  memoryRequest: "320Mi",
  memoryLimit: "320Mi",
  maxParallelCases: 4,
  runtimeClassName: "gvisor",
  admissionNode: "sandbox-a",
  artifactStorageClassName: "local-path",
  imagePullSecretName: "registry-auth",
};
const execution = (runId = RUN_ID) => ({ runId, signal: new AbortController().signal });

function request(count: number, checker = false): SandboxRequest {
  return {
    submissionId: "submission",
    language: "cpp",
    problemType: "full_source",
    sourceCode: "int main() {}",
    judgeType: checker ? "checker" : "standard",
    judgeConfig: checker
      ? { checkerScript: "private checker program", checkerLanguage: "python" }
      : {},
    limits: { timeoutMs: 1000, memoryMb: 256 },
    testcases: Array.from({ length: count }, (_, index) => ({
      index,
      input: `input-${index}\n`,
      output: `secret-answer-${index}\n`,
      weight: 1,
      isSample: false,
    })),
  };
}

function clients(
  options: { bindingMode?: string; compilationError?: string; published?: boolean } = {},
) {
  const jobs: k8s.V1Job[] = [];
  const configMaps: k8s.V1ConfigMap[] = [];
  const pvcs: k8s.V1PersistentVolumeClaim[] = [];
  const liveJobs = new Map<string, k8s.V1Job>();
  const livePods = new Map<string, k8s.V1Pod>();
  const liveConfigMaps = new Map<string, k8s.V1ConfigMap>();
  const livePvcs = new Map<string, k8s.V1PersistentVolumeClaim>();
  let serial = 0;
  const metadata = (meta: k8s.V1ObjectMeta | undefined) => ({
    ...meta,
    uid: `uid-${++serial}`,
  });
  const missing = () => Object.assign(new Error("not found"), { code: 404 });
  const coreApi = {
    listNamespacedResourceQuota: vi.fn(async () => ({ items: [] })),
    createNamespacedConfigMap: vi.fn(async ({ body }: { body: k8s.V1ConfigMap }) => {
      const cm = { ...structuredClone(body), metadata: metadata(body.metadata) };
      configMaps.push(cm);
      liveConfigMaps.set(cm.metadata.name!, cm);
      return cm;
    }),
    listNamespacedConfigMap: vi.fn(async () => ({ items: [...liveConfigMaps.values()] })),
    deleteNamespacedConfigMap: vi.fn(async ({ name }: { name: string }) => {
      liveConfigMaps.delete(name);
    }),
    createNamespacedPersistentVolumeClaim: vi.fn(
      async ({ body }: { body: k8s.V1PersistentVolumeClaim }) => {
        const pvc = { ...structuredClone(body), metadata: metadata(body.metadata) };
        pvcs.push(pvc);
        livePvcs.set(pvc.metadata.name!, pvc);
        return pvc;
      },
    ),
    readNamespacedPersistentVolumeClaim: vi.fn(async ({ name }: { name: string }) => {
      const pvc = livePvcs.get(name);
      if (!pvc) throw missing();
      return pvc;
    }),
    listNamespacedPersistentVolumeClaim: vi.fn(async () => ({ items: [...livePvcs.values()] })),
    deleteNamespacedPersistentVolumeClaim: vi.fn(
      async ({ name, body }: { name: string; body?: k8s.V1DeleteOptions }) => {
        const pvc = livePvcs.get(name);
        if (pvc && body?.preconditions?.uid !== pvc.metadata?.uid)
          throw new Error("PVC UID precondition required");
        livePvcs.delete(name);
      },
    ),
    listNamespacedService: vi.fn(async () => ({ items: [] })),
    deleteNamespacedService: vi.fn(async () => undefined),
    listNamespacedPod: vi.fn(async ({ labelSelector }: { labelSelector?: string }) => ({
      items: [...livePods.values()].filter(
        (pod) =>
          !labelSelector || pod.metadata?.labels?.["job-name"] === labelSelector.split("=")[1],
      ),
    })),
    deleteNamespacedPod: vi.fn(async ({ name }: { name: string }) => {
      livePods.delete(name);
    }),
    readNamespacedPodLog: vi.fn(async ({ container }: { container: string }) => {
      if (container === "prepare")
        return JSON.stringify(
          options.compilationError
            ? { compilationError: options.compilationError }
            : { runCommand: ["/artifact/main"] },
        );
      if (container === "publish-artifact")
        return JSON.stringify({ published: options.published ?? true, bytes: 123, files: 2 });
      const index = Number(container.replace("case-", ""));
      return JSON.stringify({
        rawRuns: [
          {
            index,
            stdout: `secret-answer-${index}\n`,
            stderr: "",
            exitCode: 0,
            timeMs: index + 1,
          },
        ],
      });
    }),
  };
  const batchApi = {
    createNamespacedJob: vi.fn(async ({ body }: { body: k8s.V1Job }) => {
      const job = {
        ...structuredClone(body),
        metadata: metadata(body.metadata),
        status: { succeeded: 1 },
      };
      const name = job.metadata.name!;
      if (liveJobs.has(name)) throw new Error("Job already exists");
      jobs.push(job);
      liveJobs.set(name, job);
      livePods.set(`${name}-pod`, {
        metadata: {
          name: `${name}-pod`,
          uid: `pod-uid-${++serial}`,
          labels: { "job-name": name },
          ownerReferences: [
            { apiVersion: "batch/v1", kind: "Job", name, uid: job.metadata.uid },
          ],
        },
        spec: { ...job.spec!.template.spec!, nodeName: CONFIG.admissionNode },
        status: { phase: "Succeeded" },
      });
      return job;
    }),
    readNamespacedJob: vi.fn(async ({ name }: { name: string }) => {
      const job = liveJobs.get(name);
      if (!job) throw missing();
      return job;
    }),
    listNamespacedJob: vi.fn(async () => ({ items: [...liveJobs.values()] })),
    deleteNamespacedJob: vi.fn(
      async ({ name, body }: { name: string; body?: k8s.V1DeleteOptions }) => {
        const job = liveJobs.get(name);
        if (job && body?.preconditions?.uid !== job.metadata?.uid)
          throw new Error("Job UID precondition required");
        liveJobs.delete(name);
        livePods.delete(`${name}-pod`);
      },
    ),
  };
  const storageApi = {
    readStorageClass: vi.fn(async () => ({
      volumeBindingMode: options.bindingMode ?? "WaitForFirstConsumer",
    })),
  };
  const networkingApi = {
    listNamespacedNetworkPolicy: vi.fn(async () => ({ items: [] })),
    deleteNamespacedNetworkPolicy: vi.fn(async () => undefined),
  };
  const watch = { watch: vi.fn(async () => new AbortController()) };
  return {
    handles: {
      coreApi,
      batchApi,
      storageApi,
      networkingApi,
      watch,
    } as unknown as K8sClientHandles,
    coreApi,
    batchApi,
    storageApi,
    record: { jobs, configMaps, pvcs, liveJobs, livePods, liveConfigMaps, livePvcs },
  };
}

function payload(job: k8s.V1Job, configMaps: k8s.V1ConfigMap[]): Record<string, string> {
  const names = job
    .spec!.template.spec!.volumes!.find((v) => v.name === "payload")!
    .projected!.sources!.map((source) => source.configMap!.name);
  const maps = configMaps.filter((cm) => names.includes(cm.metadata!.name));
  const manifest = JSON.parse(
    maps.find((cm) => cm.data?.["payload-manifest.json"])!.data!["payload-manifest.json"]!,
  ) as SandboxPayloadManifest;
  const chunks = Object.assign({}, ...maps.map((cm) => cm.binaryData ?? {})) as Record<
    string,
    string
  >;
  return Object.fromEntries(
    manifest.files.map((file) => [
      file.path,
      Buffer.concat(file.chunks.map((key) => Buffer.from(chunks[key]!, "base64"))).toString(
        "utf8",
      ),
    ]),
  );
}

async function prepared(
  executor: K8sExecutor,
  req: SandboxRequest,
): Promise<PreparedArtifactReference> {
  const result = await executor.prepareAttempt(req, execution());
  expect(result.compilationError).toBeUndefined();
  expect(result.artifact).toBeDefined();
  return result.artifact!;
}

describe("Kubernetes prepared attempt orchestration", () => {
  it.each(["before-storage-read", "during-storage-read", "during-pvc-create"])(
    "stops normal cancelled prepare at %s before launching a Job",
    async (phase) => {
      const fake = clients();
      const controller = new AbortController();
      const executor = new K8sExecutor(CONFIG, fake.handles);
      if (phase === "before-storage-read") controller.abort(new Error("Cancelled prepare"));
      if (phase === "during-storage-read") {
        const read = fake.storageApi.readStorageClass.getMockImplementation()!;
        fake.storageApi.readStorageClass.mockImplementationOnce(async () => {
          const result = await read();
          controller.abort(new Error("Cancelled prepare"));
          return result;
        });
      }
      if (phase === "during-pvc-create") {
        const create =
          fake.coreApi.createNamespacedPersistentVolumeClaim.getMockImplementation()!;
        fake.coreApi.createNamespacedPersistentVolumeClaim.mockImplementationOnce(
          async (args) => {
            const result = await create(args);
            controller.abort(new Error("Cancelled prepare"));
            return result;
          },
        );
      }
      await expect(
        executor.prepareAttempt(request(1), { runId: RUN_ID, signal: controller.signal }),
      ).rejects.toThrow("Cancelled prepare");
      expect(fake.record.jobs).toHaveLength(0);
      expect(fake.record.configMaps).toHaveLength(0);
      expect(fake.record.pvcs).toHaveLength(phase === "during-pvc-create" ? 1 : 0);
      await executor.cleanupRun(RUN_ID);
      expect(fake.record.livePvcs.size).toBe(0);
    },
  );
  it.each([1, 20, 100])(
    "compiles exactly once for %i cases, executes fresh bounded waves and preserves all indices",
    async (count) => {
      const fake = clients();
      const executor = new K8sExecutor(CONFIG, fake.handles);
      const req = request(count);
      const artifact = await prepared(executor, req);
      const rawRuns: RawCaseRun[] = [];
      for (let start = 0; start < count; start += 4) {
        const indices = req.testcases.slice(start, start + 4).map((tc) => tc.index);
        const wave = await executor.executePreparedWave(req, execution(), artifact, indices);
        expect(wave.rawRuns?.map((run) => run.index)).toEqual(indices);
        rawRuns.push(...wave.rawRuns!);
      }
      const result = await executor.finishPreparedAttempt(req, execution(), rawRuns);
      expect(result.testcaseResults.map((tc) => tc.index)).toEqual(
        req.testcases.map((tc) => tc.index),
      );
      expect(result.testcaseResults.every((tc) => tc.verdict === "AC")).toBe(true);
      expect(fake.record.pvcs).toHaveLength(1);
      expect(fake.record.jobs).toHaveLength(1 + Math.ceil(count / 4));
      const compileJobs = fake.record.jobs.filter((job) =>
        job.spec!.template.spec!.initContainers!.some((container) =>
          container.env?.some((env) => env.name === "SANDBOX_PHASE" && env.value === "prepare"),
        ),
      );
      expect(compileJobs).toHaveLength(1);
      expect(
        fake.coreApi.readNamespacedPodLog.mock.calls.filter(
          ([args]) => args.container === "prepare",
        ),
      ).toHaveLength(1);
      const cases = fake.record.jobs
        .slice(1)
        .flatMap((job) => job.spec!.template.spec!.containers);
      expect(cases.map((container) => container.name)).toEqual(
        req.testcases.map((tc) => `case-${tc.index}`),
      );
      for (const job of fake.record.jobs.slice(1)) {
        const spec = job.spec!.template.spec!;
        expect(spec.containers.length).toBeLessThanOrEqual(4);
        expect(spec.nodeName).toBeUndefined();
        expect(spec.imagePullSecrets).toEqual([{ name: "registry-auth" }]);
        expect(job.metadata?.labels?.["nojv-run-id"]).toBe(RUN_ID);
        expect(job.spec?.template.metadata?.labels?.["nojv-run-id"]).toBe(RUN_ID);
        expect(spec.initContainers!.map((container) => container.name)).toEqual([
          "materialize",
        ]);
        expect(spec.volumes).toContainEqual({
          name: "artifact",
          persistentVolumeClaim: { claimName: artifact.pvcName, readOnly: true },
        });
        for (const container of spec.containers) {
          expect(container.volumeMounts).toContainEqual({
            name: "artifact",
            mountPath: "/artifact",
            subPath: "published",
            readOnly: true,
          });
          expect(container.volumeMounts).toContainEqual({
            name: "scratch-tmp",
            mountPath: "/tmp",
            subPath: container.name,
          });
        }
      }
      for (const job of fake.record.jobs) {
        const content = JSON.stringify(payload(job, fake.record.configMaps));
        expect(content).not.toContain("secret-answer");
        expect(content).not.toContain("private checker program");
      }
      expect(
        Object.keys(payload(compileJobs[0]!, fake.record.configMaps)).some((key) =>
          key.startsWith("testcase-"),
        ),
      ).toBe(false);
      expect(fake.record.liveJobs.size).toBe(0);
      expect(fake.record.livePods.size).toBe(0);
      expect(fake.record.liveConfigMaps.size).toBe(0);
      expect(fake.record.livePvcs.size).toBe(1);
      await executor.cleanupRun(RUN_ID);
      expect(fake.record.livePvcs.size).toBe(0);
    },
  );

  it("keeps checker source and answers out of compile and testcase payloads", async () => {
    const fake = clients();
    const executor = new K8sExecutor(CONFIG, fake.handles);
    const req = request(2, true);
    const artifact = await prepared(executor, req);
    await executor.executePreparedWave(req, execution(), artifact, [0, 1]);
    for (const job of fake.record.jobs) {
      expect(JSON.stringify(payload(job, fake.record.configMaps))).not.toMatch(
        /secret-answer|private checker program/,
      );
    }
  });

  it("grades prepared checker outputs separately without compiling the student again", async () => {
    const fake = clients();
    const executor = new K8sExecutor(CONFIG, fake.handles);
    const req = request(2, true);
    const artifact = await prepared(executor, req);
    const wave = await executor.executePreparedWave(req, execution(), artifact, [0, 1]);
    const originalLog = fake.coreApi.readNamespacedPodLog.getMockImplementation()!;
    fake.coreApi.readNamespacedPodLog.mockImplementation(async (args) =>
      args.container === "runner"
        ? JSON.stringify({
            validatorOutcomes: [
              { index: 0, verdict: "AC" },
              { index: 1, verdict: "WA" },
            ],
          })
        : originalLog(args),
    );
    const result = await executor.finishPreparedAttempt(req, execution(), wave.rawRuns!);
    expect(result.testcaseResults.map((tc) => tc.verdict)).toEqual(["AC", "WA"]);
    const validator = fake.record.jobs.find((job) =>
      job.metadata!.name!.endsWith("-validate"),
    )!;
    const privatePayload = payload(validator, fake.record.configMaps);
    expect(privatePayload["validator.py"]).toBe("private checker program");
    expect(privatePayload["case-0-answer.txt"]).toBe("secret-answer-0\n");
    expect(JSON.stringify(privatePayload)).not.toContain("int main() {}");
    expect(
      validator.spec!.template.spec!.volumes!.some(
        (volume) => volume.persistentVolumeClaim?.claimName === artifact.pvcName,
      ),
    ).toBe(false);
    expect(
      fake.coreApi.readNamespacedPodLog.mock.calls.filter(
        ([args]) => args.container === "prepare",
      ),
    ).toHaveLength(1);
    await executor.cleanupRun(RUN_ID);
    expect(fake.record.livePvcs.size).toBe(0);
  });

  it("rejects artifacts from another run, PVC identity or node before creating any testcase Job", async () => {
    const fake = clients();
    const executor = new K8sExecutor(CONFIG, fake.handles);
    const req = request(1);
    const artifact = await prepared(executor, req);
    for (const invalid of [
      { ...artifact, runId: OTHER_RUN_ID },
      { ...artifact, pvcName: `judge-${OTHER_RUN_ID}-artifact` },
      { ...artifact, nodeName: "other-node" },
    ]) {
      await expect(
        executor.executePreparedWave(req, execution(), invalid, [0]),
      ).rejects.toThrow("Artifact ownership mismatch");
    }
    await expect(
      executor.executePreparedWave(
        req,
        execution(),
        { ...artifact, pvcUid: "replacement-uid" },
        [0],
      ),
    ).rejects.toThrow("new attempt is required");
    expect(fake.record.jobs).toHaveLength(1);
  });

  it("rejects Immediate StorageClasses before allocating any run resources", async () => {
    const fake = clients({ bindingMode: "Immediate" });
    await expect(
      new K8sExecutor(CONFIG, fake.handles).prepareAttempt(request(1), execution()),
    ).rejects.toThrow("WaitForFirstConsumer");
    expect(fake.record.jobs).toEqual([]);
    expect(fake.record.pvcs).toEqual([]);
    expect(fake.record.configMaps).toEqual([]);
  });

  it("returns CE without an artifact or testcase wave and cleans the compile resources", async () => {
    const fake = clients({ compilationError: "syntax error" });
    const executor = new K8sExecutor(CONFIG, fake.handles);
    expect(await executor.prepareAttempt(request(100), execution())).toEqual({
      compilationError: "syntax error",
    });
    expect(fake.record.jobs).toHaveLength(1);
    expect(fake.record.liveJobs.size).toBe(0);
    expect(fake.record.liveConfigMaps.size).toBe(0);
    expect(
      fake.coreApi.readNamespacedPodLog.mock.calls.some(
        ([args]) => args.container === "publish-artifact",
      ),
    ).toBe(false);
    await executor.cleanupRun(RUN_ID);
    expect(fake.record.livePvcs.size).toBe(0);
  });

  it("does not let trailing runner telemetry hide a compilation error", async () => {
    const fake = clients({ compilationError: "syntax error" });
    const originalLog = fake.coreApi.readNamespacedPodLog.getMockImplementation()!;
    fake.coreApi.readNamespacedPodLog.mockImplementation(
      async (args) =>
        `${await originalLog(args)}\n${JSON.stringify({ nojvResourceUsage: { cpuUsec: 123, throttledUsec: 0, memoryPeakBytes: 1000 } })}`,
    );
    const executor = new K8sExecutor(CONFIG, fake.handles);
    expect(await executor.prepareAttempt(request(1), execution())).toEqual({
      compilationError: "syntax error",
    });
    expect(
      fake.coreApi.readNamespacedPodLog.mock.calls.some(
        ([args]) => args.container === "publish-artifact",
      ),
    ).toBe(false);
  });

  it("keeps finalizer-blocked PVC cleanup pending until its original UID disappears", async () => {
    vi.useFakeTimers();
    try {
      const fake = clients();
      const executor = new K8sExecutor(CONFIG, fake.handles);
      await prepared(executor, request(1));
      fake.coreApi.deleteNamespacedPersistentVolumeClaim.mockResolvedValue(undefined);
      const cleanup = executor.cleanupRun(RUN_ID);
      await Promise.all([
        expect(cleanup).rejects.toThrow("cleanup_pending"),
        vi.advanceTimersByTimeAsync(30_000),
      ]);
      expect(fake.record.livePvcs.size).toBe(1);
      fake.record.livePvcs.clear();
      await executor.cleanupRun(RUN_ID);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not expose an artifact when the publisher fails", async () => {
    const fake = clients({ published: false });
    const executor = new K8sExecutor(CONFIG, fake.handles);
    await expect(executor.prepareAttempt(request(1), execution())).rejects.toThrow(
      "Artifact publication failed",
    );
    expect(fake.record.jobs).toHaveLength(1);
    expect(fake.record.liveConfigMaps.size).toBe(0);
    await executor.cleanupRun(RUN_ID);
    expect(fake.record.livePvcs.size).toBe(0);
  });

  it("retains the artifact and payload when a testcase Pod cannot be terminated", async () => {
    vi.useFakeTimers();
    try {
      const fake = clients();
      const executor = new K8sExecutor(CONFIG, fake.handles);
      const req = request(1);
      const artifact = await prepared(executor, req);
      fake.batchApi.deleteNamespacedJob.mockRejectedValue(
        Object.assign(new Error("FailedKillPod transport failure"), { code: 503 }),
      );
      const wave = executor.executePreparedWave(req, execution(), artifact, [0]);
      await Promise.all([
        expect(wave).rejects.toThrow("cleanup_pending"),
        vi.runAllTimersAsync(),
      ]);
      expect(fake.record.liveJobs.size).toBe(1);
      expect(fake.record.livePods.size).toBe(1);
      expect(fake.record.liveConfigMaps.size).toBeGreaterThan(0);
      expect(fake.record.livePvcs.size).toBe(1);
      const cleanup = executor.cleanupRun(RUN_ID);
      await Promise.all([
        expect(cleanup).rejects.toThrow("cleanup_pending"),
        vi.runAllTimersAsync(),
      ]);
      expect(fake.record.liveConfigMaps.size).toBeGreaterThan(0);
      expect(fake.coreApi.deleteNamespacedPersistentVolumeClaim).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
