import { createRequire } from "node:module";

import type * as k8s from "@kubernetes/client-node";

import { createLogger } from "../logger.js";
import {
  HARDENED_CONTAINER_SECURITY_CONTEXT,
  SANDBOX_NODE_SELECTOR,
  SANDBOX_POD_SECURITY_CONTEXT,
  SANDBOX_TOLERATIONS,
  runtimeClassField,
} from "./k8s-pod-spec";

const require = createRequire(import.meta.url);
const logger = createLogger("k8s-runtime-probe");

const PROBE_ACTIVE_DEADLINE_SECONDS = 30;
const PROBE_POLL_INTERVAL_MS = 500;
const PROBE_WAIT_TIMEOUT_MS = 60_000;

export const RUNTIME_PROBE_IMAGE_COMMAND = [
  "node",
  "-e",
  "process.stdout.write('NOJV_GVISOR_RUNTIME_OK\\n')",
];

export interface RuntimeProbePodParams {
  namespace: string;
  image: string;
  podName: string;
  runtimeClassName: string;
  imagePullSecretName?: string;
}

export function runtimeProbePodName(): string {
  return "nojv-runtime-probe";
}

export function buildRuntimeProbePodManifest(params: RuntimeProbePodParams): k8s.V1Pod {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: params.podName,
      namespace: params.namespace,
      labels: { app: "nojv-sandbox", "nojv-role": "sandbox" },
    },
    spec: {
      restartPolicy: "Never",
      activeDeadlineSeconds: PROBE_ACTIVE_DEADLINE_SECONDS,
      automountServiceAccountToken: false,
      ...runtimeClassField(params.runtimeClassName),
      ...(params.imagePullSecretName
        ? { imagePullSecrets: [{ name: params.imagePullSecretName }] }
        : {}),
      nodeSelector: SANDBOX_NODE_SELECTOR,
      tolerations: SANDBOX_TOLERATIONS,
      securityContext: SANDBOX_POD_SECURITY_CONTEXT,
      containers: [
        {
          name: "probe",
          image: params.image,
          command: RUNTIME_PROBE_IMAGE_COMMAND,
          resources: {
            requests: { cpu: "100m", memory: "64Mi" },
            limits: { cpu: "100m", memory: "64Mi" },
          },
          securityContext: HARDENED_CONTAINER_SECURITY_CONTEXT,
        },
      ],
    },
  };
}

export interface RuntimeProbeDeps {
  readRuntimeClass: (name: string) => Promise<void>;
  createPod: (namespace: string, body: k8s.V1Pod) => Promise<void>;
  readPod: (name: string, namespace: string) => Promise<k8s.V1Pod>;
  deletePod: (name: string, namespace: string) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RuntimeProbeResult {
  ok: boolean;
  reason: string;
}

export interface VerifyRuntimeParams {
  namespace: string;
  image: string;
  runtimeClassName: string;
  imagePullSecretName?: string;
  deps?: RuntimeProbeDeps;
}

async function runRuntimeProbe(params: VerifyRuntimeParams): Promise<RuntimeProbeResult> {
  const deps = params.deps ?? createDefaultProbeDeps();
  const podName = runtimeProbePodName();
  const now = deps.now ?? (() => Date.now());
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  try {
    await deps.readRuntimeClass(params.runtimeClassName);
  } catch (error) {
    return {
      ok: false,
      reason: `RuntimeClass ${params.runtimeClassName} is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  await deps.deletePod(podName, params.namespace).catch(() => undefined);
  try {
    await deps.createPod(
      params.namespace,
      buildRuntimeProbePodManifest({
        namespace: params.namespace,
        image: params.image,
        podName,
        runtimeClassName: params.runtimeClassName,
        ...(params.imagePullSecretName
          ? { imagePullSecretName: params.imagePullSecretName }
          : {}),
      }),
    );

    const deadline = now() + PROBE_WAIT_TIMEOUT_MS;
    while (now() < deadline) {
      const pod = await deps.readPod(podName, params.namespace);
      if (pod.spec?.runtimeClassName !== params.runtimeClassName) {
        return {
          ok: false,
          reason: `Runtime probe Pod did not retain RuntimeClass ${params.runtimeClassName}.`,
        };
      }
      if (pod.status?.phase === "Succeeded") {
        return { ok: true, reason: "sandbox runtime probe succeeded" };
      }
      if (pod.status?.phase === "Failed") {
        const reason = pod.status.reason ?? pod.status.message ?? "unknown Pod failure";
        return { ok: false, reason: `sandbox runtime probe failed: ${reason}` };
      }
      await sleep(PROBE_POLL_INTERVAL_MS);
    }
    return { ok: false, reason: "sandbox runtime probe timed out" };
  } catch (error) {
    return {
      ok: false,
      reason: `sandbox runtime probe could not be verified: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  } finally {
    await deps.deletePod(podName, params.namespace).catch(() => undefined);
  }
}

export async function verifySandboxRuntime(
  params: VerifyRuntimeParams,
): Promise<RuntimeProbeResult> {
  const result = await runRuntimeProbe(params);
  if (result.ok) {
    logger.info("sandbox runtime verified", {
      namespace: params.namespace,
      runtimeClassName: params.runtimeClassName,
    });
  } else {
    logger.error("sandbox runtime verification failed", {
      namespace: params.namespace,
      runtimeClassName: params.runtimeClassName,
      reason: result.reason,
    });
  }
  return result;
}

function createDefaultProbeDeps(): RuntimeProbeDeps {
  const k8sLib = require("@kubernetes/client-node") as typeof k8s;
  const kc = new k8sLib.KubeConfig();
  kc.loadFromCluster();
  const coreApi = kc.makeApiClient(k8sLib.CoreV1Api);
  const nodeApi = kc.makeApiClient(k8sLib.NodeV1Api);

  return {
    readRuntimeClass: async (name) => {
      await nodeApi.readRuntimeClass({ name });
    },
    createPod: async (namespace, body) => {
      await coreApi.createNamespacedPod({ namespace, body });
    },
    readPod: (name, namespace) => coreApi.readNamespacedPod({ name, namespace }),
    deletePod: async (name, namespace) => {
      await coreApi.deleteNamespacedPod({
        name,
        namespace,
        propagationPolicy: "Background",
      });
    },
  };
}
