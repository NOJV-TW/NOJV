import type * as https from "node:https";
import { createRequire } from "node:module";

import type * as k8s from "@kubernetes/client-node";
import {
  type SandboxExecutionContext,
  type SandboxExecutor,
  type SandboxRequest,
  type SandboxResult,
} from "@nojv/core";

import { KubernetesAdvancedExecutor } from "./advanced-executor";
import { KubernetesInteractiveExecutor } from "./interactive-executor";
import { KubernetesJobWatcher, type K8sWatchClient } from "./job-watch";
import { KubernetesSandboxCleanup } from "./resource-cleanup";
import { KubernetesSandboxResources } from "./resources";
import { KubernetesExecutionObserver } from "./execution-observer";
import { KubernetesStandardExecutor } from "./standard-executor";
import { SandboxImagePullError } from "./errors";
import type { TestcaseReader } from "../shared/testcase-text";
import { sandboxSystemError } from "../shared/sandbox-plan";

const require = createRequire(import.meta.url);

export interface K8sExecutorConfig {
  namespace: string;
  image: string;
  cpuRequest: string;
  cpuLimit: string;
  runParallelism?: number;
  memoryRequest: string;
  memoryLimit: string;
  headroomMb?: number;
  maxMemoryMb?: number;
  imagePullSecretName?: string;
  sidecarReadinessTimeoutMs?: number;
  sidecarReadinessIntervalMs?: number;
  runtimeClassName?: string;
  readTestcase?: TestcaseReader;
}

export interface K8sClientHandles {
  coreApi: k8s.CoreV1Api;
  batchApi: k8s.BatchV1Api;
  networkingApi?: k8s.NetworkingV1Api;
  watch: K8sWatchClient;
}

export function createKubeConfig(): k8s.KubeConfig {
  const k8sLib = require("@kubernetes/client-node") as typeof k8s;
  return new (class extends k8sLib.KubeConfig {
    override createDispatcherOptions(
      cluster: k8s.Cluster | null,
      agentOptions: https.AgentOptions,
    ): ReturnType<k8s.KubeConfig["createDispatcherOptions"]> {
      const options = super.createDispatcherOptions(cluster, agentOptions);
      return options.type === "agent"
        ? { ...options, connect: { ...options.connect, ...{ allowH2: false } } }
        : options;
    }
  })();
}

function createK8sClientHandles(): K8sClientHandles {
  const k8sLib = require("@kubernetes/client-node") as typeof k8s;
  const kubeConfig = createKubeConfig();
  kubeConfig.loadFromCluster();
  return {
    coreApi: kubeConfig.makeApiClient(k8sLib.CoreV1Api),
    batchApi: kubeConfig.makeApiClient(k8sLib.BatchV1Api),
    networkingApi: kubeConfig.makeApiClient(k8sLib.NetworkingV1Api),
    watch: new k8sLib.Watch(kubeConfig),
  };
}

export class K8sExecutor implements SandboxExecutor {
  private readonly cleanupResources: KubernetesSandboxCleanup;
  private readonly advanced: KubernetesAdvancedExecutor;
  private readonly interactive: KubernetesInteractiveExecutor;
  private readonly standard: KubernetesStandardExecutor;

  constructor(config: K8sExecutorConfig, clients?: K8sClientHandles) {
    const handles = clients ?? createK8sClientHandles();
    const { coreApi, batchApi, networkingApi, watch } = handles;
    const jobWatcher = new KubernetesJobWatcher(coreApi, batchApi, watch);
    const resources = new KubernetesSandboxResources(config, coreApi, batchApi);
    this.cleanupResources = new KubernetesSandboxCleanup(
      config.namespace,
      coreApi,
      batchApi,
      networkingApi,
    );
    const observer = new KubernetesExecutionObserver(coreApi);

    this.advanced = new KubernetesAdvancedExecutor(
      config,
      coreApi,
      jobWatcher,
      resources,
      this.cleanupResources,
      observer,
    );
    this.interactive = new KubernetesInteractiveExecutor(
      config,
      jobWatcher,
      resources,
      this.cleanupResources,
      observer,
    );
    this.standard = new KubernetesStandardExecutor(
      config,
      jobWatcher,
      resources,
      this.cleanupResources,
      observer,
    );
  }

  reconcile(runId: string, owner?: string): Promise<boolean> {
    return this.cleanupResources.reconcile(runId, owner);
  }

  async execute(
    request: SandboxRequest,
    execution: SandboxExecutionContext,
  ): Promise<SandboxResult> {
    execution.signal.throwIfAborted();
    try {
      if (request.advanced) return await this.advanced.execute(request, execution);
      if (request.judgeType === "interactive")
        return await this.interactive.execute(request, execution);
      return await this.standard.execute(request, execution);
    } catch (error) {
      execution.signal.throwIfAborted();
      if (error instanceof SandboxImagePullError) {
        return { ...sandboxSystemError(error.message), scoringFeedback: error.message };
      }
      throw error;
    }
  }
}
