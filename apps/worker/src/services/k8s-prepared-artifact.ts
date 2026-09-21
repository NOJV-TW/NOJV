import type { V1Job, V1PersistentVolumeClaim } from "@kubernetes/client-node";

import { parseResourceQuantity } from "./judge-capacity";
import { buildPerCaseSandboxJobManifest } from "./k8s-job-manifests";
import {
  HARDENED_CONTAINER_SECURITY_CONTEXT,
  SANDBOX_POD_SECURITY_CONTEXT_WITH_FSGROUP,
} from "./k8s-pod-spec";

export function buildArtifactPvcManifest(params: {
  runId: string;
  namespace: string;
  storageClassName: string;
}): V1PersistentVolumeClaim {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: `judge-${params.runId}-artifact`,
      namespace: params.namespace,
      labels: { app: "nojv-sandbox", "nojv-run-id": params.runId },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: params.storageClassName,
      resources: { requests: { storage: "256Mi" } },
    },
  };
}

export interface PreparedArtifactJobParams {
  jobName: string;
  namespace: string;
  configMapNames: string[];
  image: string;
  memoryLimit: string;
  runtimeClassName?: string;
  nodeName: string;
  pvcName: string;
  activeDeadlineSeconds?: number;
}

function baseManifest(params: PreparedArtifactJobParams, caseIndices: number[]): V1Job {
  const compilerMemoryLimit =
    parseResourceQuantity(params.memoryLimit) < 512 * 1024 ** 2 ? "512Mi" : params.memoryLimit;
  const job = buildPerCaseSandboxJobManifest({
    jobName: params.jobName,
    namespace: params.namespace,
    configMapNames: params.configMapNames,
    image: params.image,
    cpuRequest: "1",
    caseCpuRequest: "1",
    cpuLimit: "1",
    memoryRequest: params.memoryLimit,
    memoryLimit: params.memoryLimit,
    compilerMemoryLimit,
    activeDeadlineSeconds: params.activeDeadlineSeconds ?? 1800,
    caseIndices,
    ...(params.runtimeClassName ? { runtimeClassName: params.runtimeClassName } : {}),
  });
  const spec = job.spec?.template.spec;
  if (!spec || !job.spec) throw new Error("Prepared artifact Job has no Pod spec");
  delete job.spec.ttlSecondsAfterFinished;
  spec.securityContext = SANDBOX_POD_SECURITY_CONTEXT_WITH_FSGROUP;
  spec.affinity = {
    nodeAffinity: {
      requiredDuringSchedulingIgnoredDuringExecution: {
        nodeSelectorTerms: [
          {
            matchFields: [{ key: "metadata.name", operator: "In", values: [params.nodeName] }],
          },
        ],
      },
    },
  };
  return job;
}

export function buildPrepareArtifactJobManifest(params: PreparedArtifactJobParams): V1Job {
  const job = baseManifest(params, []);
  const spec = job.spec?.template.spec;
  const prepare = spec?.initContainers?.[0];
  if (!spec || !prepare) throw new Error("Prepare Job has no compile container");
  const memory =
    parseResourceQuantity(params.memoryLimit) < 512 * 1024 ** 2 ? "512Mi" : params.memoryLimit;
  prepare.resources = { requests: { cpu: "1", memory }, limits: { cpu: "1", memory } };
  spec.containers = [
    {
      name: "publish-artifact",
      image: params.image,
      command: ["node", "/runner/index.js"],
      env: [{ name: "SANDBOX_PHASE", value: "publish-artifact" }],
      resources: { requests: { cpu: "1", memory }, limits: { cpu: "1", memory } },
      securityContext: HARDENED_CONTAINER_SECURITY_CONTEXT,
      volumeMounts: [
        { name: "artifact", mountPath: "/artifact", readOnly: true },
        { name: "artifact-output", mountPath: "/artifact-output" },
      ],
    },
  ];
  spec.volumes?.push({
    name: "artifact-output",
    persistentVolumeClaim: { claimName: params.pvcName },
  });
  return job;
}

export function buildPreparedWaveJobManifest(
  params: PreparedArtifactJobParams & { caseIndices: number[] },
): V1Job {
  if (
    params.caseIndices.length < 1 ||
    params.caseIndices.length > 4 ||
    new Set(params.caseIndices).size !== params.caseIndices.length ||
    params.caseIndices.some((index) => !Number.isSafeInteger(index) || index < 0)
  )
    throw new Error("Prepared wave requires one to four distinct testcase indices");
  const job = baseManifest(params, params.caseIndices);
  const spec = job.spec?.template.spec;
  if (!spec) throw new Error("Prepared wave Job has no Pod spec");
  spec.initContainers = [
    {
      name: "materialize",
      image: params.image,
      command: ["node", "/runner/index.js"],
      env: [{ name: "SANDBOX_PHASE", value: "materialize" }],
      resources: {
        requests: { cpu: "1", memory: params.memoryLimit },
        limits: { cpu: "1", memory: params.memoryLimit },
      },
      securityContext: HARDENED_CONTAINER_SECURITY_CONTEXT,
      volumeMounts: [
        { name: "payload", mountPath: "/payload", readOnly: true },
        { name: "submission-data", mountPath: "/submission" },
      ],
    },
  ];
  spec.volumes =
    spec.volumes?.filter((volume) => !["artifact", "compiler-tmp"].includes(volume.name)) ?? [];
  spec.volumes.push({
    name: "artifact",
    persistentVolumeClaim: { claimName: params.pvcName, readOnly: true },
  });
  for (const container of spec.containers) {
    const artifact = container.volumeMounts?.find((mount) => mount.name === "artifact");
    if (artifact) artifact.subPath = "published";
  }
  return job;
}
