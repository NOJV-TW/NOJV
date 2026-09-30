import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import type * as k8s from "@kubernetes/client-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createKubeConfig } from "../../../apps/worker/src/sandbox/kubernetes/executor.js";
import {
  HARDENED_CONTAINER_SECURITY_CONTEXT,
  SANDBOX_POD_SECURITY_CONTEXT,
} from "../../../apps/worker/src/sandbox/kubernetes/pod-spec.js";
import {
  collectOrphanRunPayloads,
  ORPHAN_PAYLOAD_MIN_AGE_MS,
} from "../../../apps/worker/src/sandbox/kubernetes/testcase-cache-gc.js";
import {
  assertK8sIntegrationOptIn,
  assertSafeK8sIntegrationTarget,
} from "../../setup/k8s-integration-target.js";

const require = createRequire(import.meta.url);

let coreApi: k8s.CoreV1Api;
let batchApi: k8s.BatchV1Api;
let namespace = "";
const orphanRun = randomUUID();
const freshRun = randomUUID();
const jobRun = randomUUID();
const cacheName = `tc-${randomUUID().replaceAll("-", "")}`;

beforeAll(async () => {
  assertK8sIntegrationOptIn(process.env);
  const k8sLib = require("@kubernetes/client-node") as typeof k8s;
  const kc = createKubeConfig();
  kc.loadFromDefault();
  namespace = assertSafeK8sIntegrationTarget({
    env: process.env,
    context: kc.getCurrentContext(),
    server: kc.getCurrentCluster()?.server ?? "",
  }).namespace;
  coreApi = kc.makeApiClient(k8sLib.CoreV1Api);
  batchApi = kc.makeApiClient(k8sLib.BatchV1Api);
}, 30_000);

afterAll(async () => {
  const names = [
    `judge-${orphanRun}-run-pm`,
    `judge-${freshRun}-run-pm`,
    `judge-${jobRun}-run-pm`,
    cacheName,
  ];
  await Promise.allSettled([
    ...names.map((name) => coreApi.deleteNamespacedConfigMap({ namespace, name })),
    batchApi.deleteNamespacedJob({
      namespace,
      name: `judge-${jobRun}`,
      body: { propagationPolicy: "Background" },
    }),
  ]);
});

function payload(runId: string): k8s.V1ConfigMap {
  return {
    metadata: { name: `judge-${runId}-run-pm`, labels: { "nojv-run-id": runId } },
    data: { "payload-manifest.json": "x".repeat(500_000) },
    immutable: true,
  };
}

describe("collectOrphanRunPayloads on k3d", () => {
  it("removes an old orphan payload and keeps fresh, running and cached ones", async () => {
    const orphan = await coreApi.createNamespacedConfigMap({
      namespace,
      body: payload(orphanRun),
    });
    await coreApi.createNamespacedConfigMap({ namespace, body: payload(jobRun) });
    await coreApi.createNamespacedConfigMap({
      namespace,
      body: { metadata: { name: cacheName }, data: { chunk: "x" } },
    });
    await batchApi.createNamespacedJob({
      namespace,
      body: {
        metadata: { name: `judge-${jobRun}`, labels: { "nojv-run-id": jobRun } },
        spec: {
          suspend: true,
          template: {
            metadata: { labels: { "nojv-run-id": jobRun } },
            spec: {
              restartPolicy: "Never",
              automountServiceAccountToken: false,
              securityContext: SANDBOX_POD_SECURITY_CONTEXT,
              containers: [
                {
                  name: "idle",
                  image: "busybox",
                  securityContext: HARDENED_CONTAINER_SECURITY_CONTEXT,
                  resources: { limits: { cpu: "100m", memory: "16Mi" } },
                },
              ],
            },
          },
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await coreApi.createNamespacedConfigMap({ namespace, body: payload(freshRun) });

    const orphanCreatedAt = orphan.metadata?.creationTimestamp;
    if (!orphanCreatedAt) throw new Error("ConfigMap is missing its creationTimestamp.");
    const now = new Date(orphanCreatedAt).getTime() + ORPHAN_PAYLOAD_MIN_AGE_MS;
    const deleted = await collectOrphanRunPayloads(coreApi, batchApi, namespace, now);

    expect(deleted).toEqual([`judge-${orphanRun}-run-pm`]);
    const remaining = (await coreApi.listNamespacedConfigMap({ namespace })).items.map(
      ({ metadata }) => metadata?.name,
    );
    expect(remaining).not.toContain(`judge-${orphanRun}-run-pm`);
    expect(remaining).toEqual(
      expect.arrayContaining([`judge-${freshRun}-run-pm`, `judge-${jobRun}-run-pm`, cacheName]),
    );
  });
});
