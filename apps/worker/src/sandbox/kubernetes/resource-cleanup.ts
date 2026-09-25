import { hostname } from "node:os";

import type * as k8s from "@kubernetes/client-node";

import { createLogger } from "../../logger.js";
import { failureMessage } from "../shared/failure-message";
import { boundedK8sCall, k8sErrorCode, retryK8sCleanupCall } from "./cleanup-call";
import { runCleanupOperations } from "./cleanup";
import {
  isK8sNotFound,
  SandboxCleanupBudget,
  terminateSandboxJob,
  terminateSandboxPod,
} from "./termination";

const logger = createLogger("k8s-executor");

export class KubernetesSandboxCleanup {
  constructor(
    private readonly namespace: string,
    private readonly coreApi: k8s.CoreV1Api,
    private readonly batchApi: k8s.BatchV1Api,
    private readonly networkingApiHandle?: k8s.NetworkingV1Api,
  ) {}

  networkingApi(): k8s.NetworkingV1Api {
    if (!this.networkingApiHandle) throw new Error("NetworkingV1Api client is not available");
    return this.networkingApiHandle;
  }

  async reconcile(runId: string, owner?: string): Promise<boolean> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId))
      return false;
    if (!owner) return false;
    if (owner !== (process.env.HOSTNAME ?? hostname())) {
      try {
        const worker = await boundedK8sCall(
          this.coreApi.readNamespacedPod({
            namespace: process.env.POD_NAMESPACE ?? "nojv",
            name: owner,
          }),
          `Worker Pod ${owner}`,
        );
        if (worker.status?.phase !== "Succeeded" && worker.status?.phase !== "Failed")
          return false;
      } catch (error) {
        if (k8sErrorCode(error) !== 404) return false;
      }
    }
    const namespace = this.namespace;
    const prefix = `judge-${runId}`;
    const owned = (metadata: k8s.V1ObjectMeta | undefined) =>
      metadata?.name === prefix || metadata?.name?.startsWith(`${prefix}-`) === true;
    interface Resource {
      metadata?: k8s.V1ObjectMeta;
    }
    interface ResourceKind {
      kind: string;
      workload: boolean;
      list: () => Promise<{ items: Resource[] }>;
      remove: (name: string, uid: string) => Promise<unknown>;
    }
    try {
      const networking = this.networkingApi();
      const kinds: ResourceKind[] = [
        {
          kind: "Job",
          workload: true,
          list: () => this.batchApi.listNamespacedJob({ namespace }),
          remove: (name, uid) =>
            this.batchApi.deleteNamespacedJob({
              namespace,
              name,
              body: { propagationPolicy: "Foreground", preconditions: { uid } },
            }),
        },
        {
          kind: "Pod",
          workload: true,
          list: () => this.coreApi.listNamespacedPod({ namespace }),
          remove: (name, uid) =>
            this.coreApi.deleteNamespacedPod({
              namespace,
              name,
              body: { propagationPolicy: "Foreground", preconditions: { uid } },
            }),
        },
        {
          kind: "ConfigMap",
          workload: false,
          list: () => this.coreApi.listNamespacedConfigMap({ namespace }),
          remove: (name, uid) =>
            this.coreApi.deleteNamespacedConfigMap({
              namespace,
              name,
              body: { preconditions: { uid } },
            }),
        },
        {
          kind: "PersistentVolumeClaim",
          workload: false,
          list: () => this.coreApi.listNamespacedPersistentVolumeClaim({ namespace }),
          remove: (name, uid) =>
            this.coreApi.deleteNamespacedPersistentVolumeClaim({
              namespace,
              name,
              body: { preconditions: { uid } },
            }),
        },
        {
          kind: "Service",
          workload: false,
          list: () => this.coreApi.listNamespacedService({ namespace }),
          remove: (name, uid) =>
            this.coreApi.deleteNamespacedService({
              namespace,
              name,
              body: { preconditions: { uid } },
            }),
        },
        {
          kind: "NetworkPolicy",
          workload: false,
          list: () => networking.listNamespacedNetworkPolicy({ namespace }),
          remove: (name, uid) =>
            networking.deleteNamespacedNetworkPolicy({
              namespace,
              name,
              body: { preconditions: { uid } },
            }),
        },
      ];
      const inventory = async (selected: ResourceKind[]) =>
        Promise.all(
          selected.map(async (kind) => {
            const { items } = await boundedK8sCall(
              kind.list(),
              `${kind.kind} list in ${namespace}`,
            );
            return { kind, items: items.filter(({ metadata }) => owned(metadata)) };
          }),
        );
      const initial = await inventory(kinds);
      if (
        initial.some(({ items }) =>
          items.some(({ metadata }) => !metadata?.uid || metadata.namespace !== namespace),
        )
      )
        return false;
      const remove = async (workload: boolean) => {
        const results = await Promise.allSettled(
          initial
            .filter(({ kind }) => kind.workload === workload)
            .flatMap(({ kind, items }) =>
              items.map(async ({ metadata }) => {
                if (!metadata?.name || !metadata.uid || metadata.deletionTimestamp) return;
                const { name, uid } = metadata;
                await retryK8sCleanupCall(
                  `${kind.kind} ${namespace}/${name}`,
                  () => kind.remove(name, uid),
                  { notFoundIsSuccess: true },
                );
              }),
            ),
        );
        return results.every((result) => result.status === "fulfilled");
      };
      if (!(await remove(true))) return false;
      const workloads = await inventory(kinds.filter((kind) => kind.workload));
      if (workloads.some(({ items }) => items.length > 0)) return false;
      if (!(await remove(false))) return false;
      return (await inventory(kinds)).every(({ items }) => items.length === 0);
    } catch (error) {
      logger.warn("Sandbox recovery could not confirm resource cleanup", {
        runId,
        error: failureMessage(error),
      });
      return false;
    }
  }

  cleanupJob(name: string, namespace: string, budget?: SandboxCleanupBudget): Promise<void> {
    return terminateSandboxJob(
      this.coreApi,
      this.batchApi,
      namespace,
      name,
      budget ? { budget } : {},
    );
  }

  cleanupPod(name: string, namespace: string, budget?: SandboxCleanupBudget): Promise<void> {
    return terminateSandboxPod(this.coreApi, namespace, name, budget ? { budget } : {});
  }

  async cleanupPvc(
    name: string,
    namespace: string,
    budget = new SandboxCleanupBudget(),
  ): Promise<void> {
    try {
      await budget.call(`PersistentVolumeClaim ${namespace}/${name}`, () =>
        this.coreApi.deleteNamespacedPersistentVolumeClaim({ name, namespace }),
      );
    } catch (error) {
      if (!isK8sNotFound(error)) throw error;
    }
  }

  async cleanupConfigMap(
    name: string,
    namespace: string,
    budget = new SandboxCleanupBudget(),
  ): Promise<void> {
    try {
      await budget.call(`ConfigMap ${namespace}/${name}`, () =>
        this.coreApi.deleteNamespacedConfigMap({ name, namespace }),
      );
    } catch (error) {
      if (!isK8sNotFound(error)) throw error;
    }
  }

  async cleanup(jobName: string, namespace: string, payloadNames: string[]): Promise<void> {
    const budget = new SandboxCleanupBudget();
    await this.cleanupJob(jobName, namespace, budget);
    await runCleanupOperations(
      "sandbox",
      payloadNames.map((name) => this.cleanupConfigMap(name, namespace, budget)),
    );
  }
}
