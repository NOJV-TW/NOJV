import { createRequire } from "node:module";

import type * as k8s from "@kubernetes/client-node";

import { createLogger } from "../../logger.js";
import { failureMessage } from "../shared/failure-message";
import { boundedK8sCall, k8sErrorCode } from "./cleanup-call";
import { createKubeConfig } from "./executor";
import {
  TESTCASE_CACHE_LABEL,
  TESTCASE_CACHE_PREFIX,
  TESTCASE_INDEX_NAME_LENGTH,
  testcaseLastUsedAt,
} from "./testcase-cache";

const require = createRequire(import.meta.url);
const logger = createLogger("k8s-testcase-cache");

export const TESTCASE_CACHE_IDLE_TTL_MS = 12 * 60 * 60_000;
const GC_INTERVAL_MS = 15 * 60_000;

function mountedTestcaseSets(pods: k8s.V1Pod[]): Set<string> {
  return new Set(
    pods.flatMap((pod) =>
      (pod.spec?.volumes ?? [])
        .flatMap((volume) => [
          volume.configMap?.name,
          ...(volume.projected?.sources ?? []).map((source) => source.configMap?.name),
        ])
        .flatMap((name) =>
          name?.startsWith(TESTCASE_CACHE_PREFIX)
            ? [name.slice(0, TESTCASE_INDEX_NAME_LENGTH)]
            : [],
        ),
    ),
  );
}

export async function collectTestcaseCache(
  coreApi: k8s.CoreV1Api,
  namespace: string,
  now = Date.now(),
): Promise<{ deleted: string[]; inUse: string[] }> {
  const [indexes, pods] = await Promise.all([
    boundedK8sCall(
      coreApi.listNamespacedConfigMap({
        namespace,
        labelSelector: `${TESTCASE_CACHE_LABEL}=index`,
      }),
      `testcase cache list in ${namespace}`,
    ),
    boundedK8sCall(coreApi.listNamespacedPod({ namespace }), `Pod list in ${namespace}`),
  ]);
  const mounted = mountedTestcaseSets(pods.items);
  const deleted: string[] = [];
  const inUse: string[] = [];
  for (const index of indexes.items) {
    const { name, uid, resourceVersion, deletionTimestamp } = index.metadata ?? {};
    if (!name || !uid || deletionTimestamp) continue;
    if (now - testcaseLastUsedAt(index) < TESTCASE_CACHE_IDLE_TTL_MS) continue;
    if (mounted.has(name)) {
      inUse.push(name);
      continue;
    }
    try {
      await boundedK8sCall(
        coreApi.deleteNamespacedConfigMap({
          name,
          namespace,
          body: {
            propagationPolicy: "Background",
            preconditions: { uid, ...(resourceVersion ? { resourceVersion } : {}) },
          },
        }),
        `ConfigMap ${namespace}/${name}`,
      );
      deleted.push(name);
    } catch (error) {
      const code = k8sErrorCode(error);
      if (code !== 404 && code !== 409) throw error;
    }
  }
  return { deleted, inUse };
}

export function startTestcaseCacheGc(namespace: string): () => void {
  const k8sLib = require("@kubernetes/client-node") as typeof k8s;
  const kubeConfig = createKubeConfig();
  kubeConfig.loadFromCluster();
  const coreApi = kubeConfig.makeApiClient(k8sLib.CoreV1Api);
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void collectTestcaseCache(coreApi, namespace)
      .then(({ deleted, inUse }) => {
        if (deleted.length > 0 || inUse.length > 0)
          logger.info("Testcase cache swept", { namespace, deleted, inUse });
      })
      .catch((error: unknown) => {
        logger.warn("Testcase cache sweep failed", { namespace, error: failureMessage(error) });
      })
      .finally(() => {
        running = false;
      });
  }, GC_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
