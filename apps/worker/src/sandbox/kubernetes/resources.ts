import type * as k8s from "@kubernetes/client-node";

import { MIN_COMPILER_MEMORY_MB, type SandboxRequest, type SandboxText } from "@nojv/core";
import { rethrowSandboxQuotaError } from "./admission";
import { boundedK8sCall } from "./cleanup-call";
import { combineExecutionAndCleanupFailure, throwCleanupFailures } from "./cleanup";
import {
  SandboxAdmissionError,
  SandboxInfeasibleError,
  SandboxInfrastructureError,
} from "./errors";
import { buildAdvancedPvcManifest } from "./advanced";
import { buildStageJobManifest } from "./job-manifests";
import { buildPayloadConfigMaps, payloadConfigMapNames } from "./payload";
import {
  KubernetesTestcaseCache,
  planTestcaseSet,
  testcaseEntry,
  testcaseManifestFile,
  type TestcaseEntry,
  type TestcaseRole,
  type TestcaseSet,
} from "./testcase-cache";
import type { StagePayloadParts } from "../shared/stage-payload";
import type { TestcaseReader } from "../shared/testcase-text";
import {
  findSandboxQuotaViolation,
  parseMemoryLimitMb,
  resolveK8sMemoryLimit,
} from "./resource-capacity";

const CONFIGMAP_MAX_BYTES = 1_000_000;
const QUOTA_CACHE_MS = 30_000;

interface SandboxResourceConfig {
  image: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  runParallelism?: number;
  headroomMb?: number;
  maxMemoryMb?: number;
  imagePullSecretName?: string;
  runtimeClassName?: string;
  readTestcase?: TestcaseReader;
}

export class KubernetesSandboxResources {
  private readonly quotaCache = new Map<
    string,
    { expiresAt: number; quotas: Promise<k8s.V1ResourceQuota[]> }
  >();

  private readonly testcaseCache: KubernetesTestcaseCache;

  constructor(
    private readonly config: SandboxResourceConfig,
    private readonly coreApi: k8s.CoreV1Api,
    private readonly batchApi: k8s.BatchV1Api,
  ) {
    this.testcaseCache = new KubernetesTestcaseCache(
      coreApi,
      config.readTestcase ? { read: config.readTestcase } : {},
    );
  }

  private runMetadata(metadata: k8s.V1ObjectMeta | undefined): k8s.V1ObjectMeta {
    const runId =
      /^judge-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:-|$)/.exec(
        metadata?.name ?? "",
      )?.[1];
    const result = metadata ?? {};
    if (runId) result.labels = { ...result.labels, "nojv-run-id": runId };
    return result;
  }

  private imagePullCredentials(spec: k8s.V1PodSpec): void {
    const name = this.config.imagePullSecretName;
    if (name && !spec.imagePullSecrets?.some((secret) => secret.name === name))
      spec.imagePullSecrets = [...(spec.imagePullSecrets ?? []), { name }];
  }

  async createPvc(name: string, namespace: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await this.coreApi
      .createNamespacedPersistentVolumeClaim({
        namespace,
        body: buildAdvancedPvcManifest({ pvcName: name, namespace }),
      })
      .catch(rethrowSandboxQuotaError);
    signal.throwIfAborted();
  }

  async createStagePayloads(
    parts: { baseName: string; payload: StagePayloadParts }[],
    namespace: string,
    signal: AbortSignal,
    cleanupConfigMap: (name: string, namespace: string) => Promise<void>,
  ): Promise<{ owned: string[]; volumes: string[][] }> {
    const entries = new Map<SandboxText, TestcaseEntry>();
    const entryOf = (text: SandboxText) => {
      const entry = entries.get(text) ?? testcaseEntry(text);
      entries.set(text, entry);
      return entry;
    };
    const files = parts.map(({ payload }) =>
      payload.testcases.map((file) => ({ ...file, entry: entryOf(file.text) })),
    );
    const sets = new Map<TestcaseRole, TestcaseSet>();
    for (const role of ["input", "answer"] as const) {
      const roleEntries = files
        .flat()
        .flatMap((file) => (file.role === role ? [file.entry] : []));
      if (roleEntries.length > 0) sets.set(role, planTestcaseSet(role, roleEntries));
    }
    entries.clear();
    const shards = new Map(
      await Promise.all(
        [...sets.values()].map(
          async (set) =>
            [set.role, await this.testcaseCache.ensure(set, namespace, signal)] as const,
        ),
      ),
    );
    const stages = parts.map(({ baseName, payload }, index) => {
      const testcases = files[index] ?? [];
      const configMaps = buildPayloadConfigMaps(
        baseName,
        namespace,
        payload.stage,
        testcases.map(({ path, role, entry }) =>
          testcaseManifestFile(path, entry, sets.get(role)),
        ),
      );
      const roles = new Set(testcases.map(({ role }) => role));
      return {
        configMaps,
        volume: [
          ...payloadConfigMapNames(configMaps),
          ...[...roles].flatMap((role) => shards.get(role) ?? []),
        ],
      };
    });
    const created: string[] = [];
    try {
      signal.throwIfAborted();
      const results = await Promise.allSettled(
        stages
          .flatMap(({ configMaps }) => configMaps)
          .map(async (configMap) => {
            configMap.metadata = this.runMetadata(configMap.metadata);
            await this.coreApi
              .createNamespacedConfigMap({ namespace, body: configMap })
              .catch(rethrowSandboxQuotaError);
            const name = configMap.metadata.name;
            if (!name) throw new Error("Created sandbox payload ConfigMap is missing a name.");
            created.push(name);
          }),
      );
      const failed = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failed) throw failed.reason;
      signal.throwIfAborted();
      return {
        owned: stages.flatMap(({ configMaps }) => payloadConfigMapNames(configMaps)),
        volumes: stages.map(({ volume }) => volume),
      };
    } catch (error) {
      const cleanup = await Promise.allSettled(
        created.map((name) => cleanupConfigMap(name, namespace)),
      );
      try {
        throwCleanupFailures("partial sandbox payload", cleanup);
      } catch (cleanupFailure) {
        throw combineExecutionAndCleanupFailure(error, cleanupFailure);
      }
      throw error;
    }
  }

  async createConfigMap(
    name: string,
    namespace: string,
    data: Record<string, string>,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const totalBytes = Object.entries(data).reduce(
      (sum, [key, value]) => sum + Buffer.byteLength(key) + Buffer.byteLength(value),
      0,
    );
    if (totalBytes > CONFIGMAP_MAX_BYTES) {
      throw new Error(
        `ConfigMap ${name} payload is ${String(totalBytes)} bytes, exceeding the ${String(CONFIGMAP_MAX_BYTES)}-byte limit; testcase data is too large for ConfigMap delivery.`,
      );
    }
    await this.coreApi
      .createNamespacedConfigMap({
        namespace,
        body: {
          metadata: this.runMetadata({ name, namespace }),
          data,
        },
      })
      .catch(rethrowSandboxQuotaError);
    signal.throwIfAborted();
  }

  private sandboxQuotas(namespace: string): Promise<k8s.V1ResourceQuota[]> {
    const cached = this.quotaCache.get(namespace);
    if (cached && cached.expiresAt > Date.now()) return cached.quotas;
    const quotas = boundedK8sCall(
      this.coreApi.listNamespacedResourceQuota({ namespace }),
      `ResourceQuota list in ${namespace}`,
    ).then((list) => list.items);
    this.quotaCache.set(namespace, { expiresAt: Date.now() + QUOTA_CACHE_MS, quotas });
    quotas.catch(() => {
      if (this.quotaCache.get(namespace)?.quotas === quotas) this.quotaCache.delete(namespace);
    });
    return quotas;
  }

  private async assertSandboxQuota(
    pods: k8s.V1PodSpec[],
    namespace: string,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    let quotas: k8s.V1ResourceQuota[];
    try {
      quotas = await this.sandboxQuotas(namespace);
    } catch (error) {
      signal.throwIfAborted();
      throw new SandboxInfrastructureError(
        `Could not inspect sandbox hard capacity in ${namespace}.`,
        { cause: error },
      );
    }
    signal.throwIfAborted();
    let violation: string | null;
    try {
      violation = findSandboxQuotaViolation(pods, quotas);
    } catch (error) {
      throw new SandboxInfrastructureError("Could not interpret sandbox hard capacity.", {
        cause: error,
      });
    }
    if (violation) throw new SandboxInfeasibleError(violation);
  }

  async createSandboxJob(
    params: { namespace: string; body: k8s.V1Job },
    signal: AbortSignal,
    companionPodName?: string,
  ): Promise<k8s.V1Job> {
    params.body.metadata = this.runMetadata(params.body.metadata);
    const template = params.body.spec?.template;
    if (template) {
      template.metadata ??= {};
      template.metadata.labels = {
        ...template.metadata.labels,
        ...params.body.metadata.labels,
      };
    }
    const spec = template?.spec;
    if (!spec) throw new SandboxAdmissionError("Sandbox Job is missing its Pod specification.");
    this.imagePullCredentials(spec);
    const pods = [spec];
    if (companionPodName) {
      try {
        const companion = await boundedK8sCall(
          this.coreApi.listNamespacedPod({
            namespace: params.namespace,
            fieldSelector: `metadata.name=${companionPodName}`,
          }),
          `sandbox companion ${companionPodName}`,
        );
        const spec = companion.items.find(
          (pod) => pod.metadata?.name === companionPodName,
        )?.spec;
        if (!spec) throw new Error("Companion Pod specification is unavailable.");
        pods.push(spec);
      } catch (error) {
        signal.throwIfAborted();
        throw new SandboxInfrastructureError(
          `Could not inspect companion ${companionPodName}.`,
          { cause: error },
        );
      }
    }
    await this.assertSandboxQuota(pods, params.namespace, signal);
    return this.batchApi.createNamespacedJob(params);
  }

  async createSandboxPod(
    params: { namespace: string; body: k8s.V1Pod },
    signal: AbortSignal,
  ): Promise<k8s.V1Pod> {
    if (!params.body.spec)
      throw new SandboxAdmissionError("Sandbox service is missing its Pod specification.");
    params.body.metadata = this.runMetadata(params.body.metadata);
    this.imagePullCredentials(params.body.spec);
    await this.assertSandboxQuota([params.body.spec], params.namespace, signal);
    return this.coreApi.createNamespacedPod(params);
  }

  async createStageJob(
    jobName: string,
    namespace: string,
    payloads: { run: string[]; judge: string[] },
    deadlineSeconds: number,
    request: SandboxRequest,
    runParallelism: number,
    runMemoryLimit: string,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const memoryLimit = resolveK8sMemoryLimit(request, this.config);
    await this.createSandboxJob(
      {
        namespace,
        body: buildStageJobManifest({
          jobName,
          namespace,
          runConfigMapNames: payloads.run,
          judgeConfigMapNames: payloads.judge,
          image: request.sandboxImage ?? this.config.image,
          cpuRequest: this.config.cpuRequest,
          cpuLimit: this.config.cpuLimit,
          memoryRequest: this.config.memoryRequest,
          compilerMemoryLimit: `${String(Math.max(parseMemoryLimitMb(memoryLimit), MIN_COMPILER_MEMORY_MB))}Mi`,
          runParallelism,
          runMemoryLimit,
          caseCount: request.testcases.length,
          activeDeadlineSeconds: deadlineSeconds,
          ...(this.config.runtimeClassName
            ? { runtimeClassName: this.config.runtimeClassName }
            : {}),
        }),
      },
      signal,
    ).catch(rethrowSandboxQuotaError);
    signal.throwIfAborted();
  }
}
