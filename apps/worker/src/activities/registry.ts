import { createRequire } from "node:module";

import { heartbeat, log } from "@temporalio/activity";

import type * as k8s from "@kubernetes/client-node";

import type { RegistryGarbageCollectInput } from "@nojv/core";

const require = createRequire(import.meta.url);

const GC_CONFIG_PATH = "/etc/distribution/config.yml";
const GC_JOB_POLL_INTERVAL_MS = 3_000;
const GC_JOB_DEADLINE_SECONDS = 20 * 60;
const GC_JOB_WATCH_BUFFER_SECONDS = 120;
const GC_JOB_TTL_SECONDS = 600;
const GC_LOG_TAIL_LINES = 200;
const GC_CONTAINER_NAME = "garbage-collect";

export interface RegistryGcConfig {
  namespace: string;
  image: string;
  configMapName: string;
  runtimeSecretName: string;
}

export interface RegistryGcClients {
  batchApi: k8s.BatchV1Api;
  coreApi: k8s.CoreV1Api;
}

function envOr(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function resolveRegistryGcConfig(
  env: Record<string, string | undefined> = process.env,
): RegistryGcConfig {
  return {
    namespace: envOr(env.REGISTRY_GC_NAMESPACE, "nojv"),
    image: envOr(env.REGISTRY_GC_IMAGE, "registry:2.8.3"),
    configMapName: envOr(env.REGISTRY_GC_CONFIG_CONFIGMAP, "nojv-registry-config"),
    runtimeSecretName: envOr(env.REGISTRY_GC_S3_SECRET, "nojv-runtime-secrets"),
  };
}

export function buildRegistryGcJobManifest(
  jobName: string,
  config: RegistryGcConfig,
): k8s.V1Job {
  return {
    metadata: { name: jobName, namespace: config.namespace },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: GC_JOB_TTL_SECONDS,
      activeDeadlineSeconds: GC_JOB_DEADLINE_SECONDS,
      template: {
        metadata: { name: jobName },
        spec: {
          restartPolicy: "Never",
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 1000,
            fsGroup: 1000,
            seccompProfile: { type: "RuntimeDefault" },
          },
          containers: [
            {
              name: GC_CONTAINER_NAME,
              image: config.image,
              imagePullPolicy: "IfNotPresent",
              command: ["garbage-collect", "--delete-untagged=false", GC_CONFIG_PATH],
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ["ALL"] },
              },
              env: [
                {
                  name: "REGISTRY_STORAGE_S3_ACCESSKEY",
                  valueFrom: {
                    secretKeyRef: { name: config.runtimeSecretName, key: "S3_ACCESS_KEY" },
                  },
                },
                {
                  name: "REGISTRY_STORAGE_S3_SECRETKEY",
                  valueFrom: {
                    secretKeyRef: { name: config.runtimeSecretName, key: "S3_SECRET_KEY" },
                  },
                },
              ],
              volumeMounts: [
                {
                  name: "config",
                  mountPath: GC_CONFIG_PATH,
                  subPath: "config.yml",
                  readOnly: true,
                },
                { name: "var-lib", mountPath: "/var/lib/registry" },
              ],
            },
          ],
          volumes: [
            { name: "config", configMap: { name: config.configMapName } },
            { name: "var-lib", emptyDir: {} },
          ],
        },
      },
    },
  };
}

function buildClients(): RegistryGcClients {
  const k8sLib = require("@kubernetes/client-node") as typeof k8s;
  const kc = new k8sLib.KubeConfig();
  kc.loadFromCluster();
  return {
    batchApi: kc.makeApiClient(k8sLib.BatchV1Api),
    coreApi: kc.makeApiClient(k8sLib.CoreV1Api),
  };
}

async function waitForJob(
  clients: RegistryGcClients,
  jobName: string,
  namespace: string,
): Promise<"succeeded" | "failed"> {
  const deadline = Date.now() + (GC_JOB_DEADLINE_SECONDS + GC_JOB_WATCH_BUFFER_SECONDS) * 1_000;
  while (Date.now() < deadline) {
    const job = await clients.batchApi.readNamespacedJob({ name: jobName, namespace });
    if (job.status?.succeeded) return "succeeded";
    if (job.status?.failed) return "failed";
    heartbeat();
    await new Promise((resolve) => setTimeout(resolve, GC_JOB_POLL_INTERVAL_MS));
  }
  return "failed";
}

async function readJobLogTail(
  clients: RegistryGcClients,
  jobName: string,
  namespace: string,
): Promise<string> {
  const pods = await clients.coreApi
    .listNamespacedPod({ namespace, labelSelector: `job-name=${jobName}` })
    .catch(() => undefined);
  const podName = pods?.items[0]?.metadata?.name;
  if (!podName) return "";
  return clients.coreApi
    .readNamespacedPodLog({
      name: podName,
      namespace,
      container: GC_CONTAINER_NAME,
      tailLines: GC_LOG_TAIL_LINES,
    })
    .catch(() => "");
}

export async function runRegistryGarbageCollect(
  input: RegistryGarbageCollectInput,
  clients: RegistryGcClients = buildClients(),
  config: RegistryGcConfig = resolveRegistryGcConfig(),
): Promise<string> {
  const jobName = `registry-gc-${Date.now().toString(36)}`;
  log.info("registry garbage-collect starting", {
    triggeredByUserId: input.triggeredByUserId,
    namespace: config.namespace,
    jobName,
  });

  await clients.batchApi.createNamespacedJob({
    namespace: config.namespace,
    body: buildRegistryGcJobManifest(jobName, config),
  });

  try {
    const outcome = await waitForJob(clients, jobName, config.namespace);
    const logs = await readJobLogTail(clients, jobName, config.namespace);
    if (outcome === "failed") {
      throw new Error(`Registry garbage-collect Job ${jobName} failed. Log tail:\n${logs}`);
    }
    log.info("registry garbage-collect completed", { jobName });
    return logs;
  } finally {
    await clients.batchApi
      .deleteNamespacedJob({
        name: jobName,
        namespace: config.namespace,
        propagationPolicy: "Background",
      })
      .catch(() => undefined);
  }
}
