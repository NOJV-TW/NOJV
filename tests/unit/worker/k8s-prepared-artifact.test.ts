import { describe, expect, it } from "vitest";

import { effectivePodRequests } from "../../../apps/worker/src/services/judge-capacity";
import {
  buildArtifactPvcManifest,
  buildPrepareArtifactJobManifest,
  buildPreparedWaveJobManifest,
} from "../../../apps/worker/src/services/k8s-prepared-artifact";

const params = {
  jobName: "judge-run-prepare",
  namespace: "sandbox",
  configMapNames: ["run-source"],
  image: "sandbox@sha256:123",
  memoryLimit: "320Mi",
  runtimeClassName: "gvisor",
  nodeName: "sandbox-a",
  pvcName: "judge-run-artifact",
  activeDeadlineSeconds: 240,
};

describe("prepared artifact Kubernetes manifests", () => {
  it("creates a run-owned bounded RWO PVC in the explicit storage class", () => {
    const pvc = buildArtifactPvcManifest({
      runId: "run",
      namespace: "sandbox",
      storageClassName: "local-path",
    });
    expect(pvc.metadata).toMatchObject({
      name: params.pvcName,
      labels: { "nojv-run-id": "run" },
    });
    expect(pvc.spec).toEqual({
      accessModes: ["ReadWriteOnce"],
      storageClassName: "local-path",
      resources: { requests: { storage: "256Mi" } },
    });
  });

  it("compiles once in bounded scratch and publishes from a read-only mount into the PVC", () => {
    const job = buildPrepareArtifactJobManifest(params);
    const pod = job.spec!.template;
    expect(pod.spec!.initContainers).toHaveLength(1);
    const compile = pod.spec!.initContainers![0]!;
    expect(compile.env).toContainEqual({ name: "SANDBOX_PHASE", value: "prepare" });
    expect(compile.resources).toEqual({
      requests: { cpu: "1", memory: "512Mi" },
      limits: { cpu: "1", memory: "512Mi" },
    });
    expect(compile.volumeMounts?.some((m) => m.name === "artifact-output")).toBe(false);
    const publisher = pod.spec!.containers[0]!;
    expect(publisher.env).toEqual([{ name: "SANDBOX_PHASE", value: "publish-artifact" }]);
    expect(publisher.volumeMounts).toEqual([
      { name: "artifact", mountPath: "/artifact", readOnly: true },
      { name: "artifact-output", mountPath: "/artifact-output" },
    ]);
    expect(pod.spec!.volumes).toContainEqual({
      name: "artifact",
      emptyDir: { sizeLimit: "256Mi" },
    });
    expect(effectivePodRequests(pod)).toEqual({
      cpuMillis: 1000,
      memoryBytes: 512 * 1024 ** 2,
    });
    expect(job.spec!.ttlSecondsAfterFinished).toBeUndefined();
  });

  it("schedules via affinity, preserves isolation and reserves full per-case resources", () => {
    const job = buildPreparedWaveJobManifest({ ...params, caseIndices: [4, 5, 6, 7] });
    const pod = job.spec!.template;
    expect(pod.spec!.nodeName).toBeUndefined();
    expect(
      pod.spec!.affinity!.nodeAffinity!.requiredDuringSchedulingIgnoredDuringExecution!
        .nodeSelectorTerms[0]!.matchFields,
    ).toEqual([{ key: "metadata.name", operator: "In", values: ["sandbox-a"] }]);
    expect(pod.spec!.runtimeClassName).toBe("gvisor");
    expect(pod.spec!.automountServiceAccountToken).toBe(false);
    expect(pod.spec!.securityContext!.fsGroup).toBe(10001);
    expect(pod.spec!.initContainers![0]!.env).toEqual([
      { name: "SANDBOX_PHASE", value: "materialize" },
    ]);
    expect(pod.spec!.initContainers![0]!.volumeMounts?.some((m) => m.name === "artifact")).toBe(
      false,
    );
    expect(pod.spec!.containers.map((c) => c.name)).toEqual([
      "case-4",
      "case-5",
      "case-6",
      "case-7",
    ]);
    for (const container of pod.spec!.containers) {
      expect(container.resources).toEqual({
        requests: { cpu: "1", memory: "320Mi" },
        limits: { cpu: "1", memory: "320Mi" },
      });
      expect(container.securityContext).toMatchObject({
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: true,
        capabilities: { drop: ["ALL"] },
      });
      expect(container.volumeMounts).toContainEqual({
        name: "artifact",
        mountPath: "/artifact",
        readOnly: true,
        subPath: "published",
      });
      expect(container.volumeMounts).toContainEqual({
        name: "scratch-tmp",
        mountPath: "/tmp",
        subPath: container.name,
      });
    }
    expect(pod.spec!.volumes).toContainEqual({
      name: "artifact",
      persistentVolumeClaim: { claimName: params.pvcName, readOnly: true },
    });
    expect(effectivePodRequests(pod)).toEqual({
      cpuMillis: 4000,
      memoryBytes: 1280 * 1024 ** 2,
    });
  });

  it("rejects empty, oversized and duplicate waves", () => {
    for (const caseIndices of [[], [0, 1, 2, 3, 4], [1, 1], [-1]])
      expect(() => buildPreparedWaveJobManifest({ ...params, caseIndices })).toThrow(
        "one to four",
      );
  });
});
