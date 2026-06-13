import { createRequire } from "node:module";

import type * as k8s from "@kubernetes/client-node";

const require = createRequire(import.meta.url);

import {
  advancedResultSchema,
  type RawCaseRun,
  type SandboxExecutor,
  type SandboxRequest,
  type SandboxResult,
  type SandboxTestcase,
  type SandboxTestcaseResult,
  type ValidatorOutcome,
} from "@nojv/core";
import { createLogger } from "../logger.js";
import { mergeInteractiveCase, type InteractiveSideResult } from "./check-interactive";
import { mergeCheckerResults, resolveSandboxResult } from "./check-standard";
import { advancedFallbackResult, mapAdvancedResult } from "./sandbox-result-mapper";
import { parseSandboxResult, parseValidateOutput } from "./sandbox-schema";
import { sandboxSystemError } from "./sandbox-plan";
import {
  buildRunConfigMapData,
  buildInteractiveInteractorConfigMapData,
  buildInteractiveSolutionConfigMapData,
  buildValidateConfigMapData,
  computeJobDeadlineSeconds,
  CONFIGMAP_MAX_BYTES,
} from "./k8s-configmaps";
import {
  ADVANCED_SIDECAR_NAME,
  buildAdvancedConfigMapData,
  buildAdvancedJobManifest,
  parseAdvancedResultLog,
} from "./k8s-advanced";

export {
  buildRunConfigMapData,
  buildInteractiveInteractorConfigMapData,
  buildInteractiveSolutionConfigMapData,
  buildTestcaseConfigMapData,
  buildValidateConfigMapData,
  computeJobDeadlineSeconds,
} from "./k8s-configmaps";
export {
  ADVANCED_GRADER_NAME,
  ADVANCED_INIT_NAME,
  ADVANCED_RESULT_MARKER_BEGIN,
  ADVANCED_RESULT_MARKER_END,
  ADVANCED_SIDECAR_NAME,
  buildAdvancedConfigMapData,
  buildAdvancedInitScript,
  buildAdvancedJobManifest,
  buildAdvancedTailScript,
  parseAdvancedResultLog,
} from "./k8s-advanced";

const logger = createLogger("k8s-executor");

export interface K8sExecutorConfig {
  namespace: string;
  image: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
}

const JOB_DEADLINE_BUFFER_SECONDS = 60;
const JOB_POLL_INTERVAL_MS = 1_000;
const TTL_AFTER_FINISHED_SECONDS = 60;

export interface SandboxJobManifestParams {
  jobName: string;
  namespace: string;
  configMapName: string;
  image: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  activeDeadlineSeconds: number;
}

export function buildSandboxJobManifest(params: SandboxJobManifestParams): k8s.V1Job {
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: params.jobName,
      namespace: params.namespace,
      labels: { app: "nojv-sandbox" },
    },
    spec: {
      ttlSecondsAfterFinished: TTL_AFTER_FINISHED_SECONDS,
      activeDeadlineSeconds: params.activeDeadlineSeconds,
      backoffLimit: 0,
      template: {
        metadata: {
          labels: { app: "nojv-sandbox", "nojv-role": "sandbox" },
        },
        spec: {
          restartPolicy: "Never",
          automountServiceAccountToken: false,
          nodeSelector: { "nojv-role": "sandbox" },
          tolerations: [
            {
              key: "nojv-role",
              operator: "Equal",
              value: "sandbox",
              effect: "NoSchedule",
            },
          ],
          securityContext: {
            runAsUser: 10001,
            runAsGroup: 10001,
            runAsNonRoot: true,
            seccompProfile: { type: "RuntimeDefault" },
          },
          containers: [
            {
              name: "runner",
              image: params.image,
              command: ["node", "/runner/index.js"],
              resources: {
                requests: { cpu: params.cpuRequest, memory: params.memoryRequest },
                limits: { cpu: params.cpuLimit, memory: params.memoryLimit },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
                readOnlyRootFilesystem: true,
                runAsNonRoot: true,
              },
              volumeMounts: [
                {
                  name: "submission-data",
                  mountPath: "/submission",
                  readOnly: true,
                },
                { name: "workspace", mountPath: "/workspace" },
                { name: "tmp", mountPath: "/tmp" },
              ],
            },
          ],
          volumes: [
            {
              name: "submission-data",
              configMap: { name: params.configMapName },
            },
            {
              name: "workspace",
              emptyDir: { sizeLimit: "128Mi" },
            },
            {
              name: "tmp",
              emptyDir: { sizeLimit: "64Mi" },
            },
          ],
        },
      },
    },
  };
}

export interface PerCaseSandboxJobManifestParams {
  jobName: string;
  namespace: string;
  configMapName: string;
  image: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  activeDeadlineSeconds: number;
  caseIndices: number[];
}

export function perCaseContainerName(index: number): string {
  return `case-${String(index)}`;
}

export const COMPILE_CONTAINER_NAME = "compile";

export function buildPerCaseSandboxJobManifest(
  params: PerCaseSandboxJobManifestParams,
): k8s.V1Job {
  const containerSecurityContext = {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ["ALL"] },
    readOnlyRootFilesystem: true,
    runAsNonRoot: true,
  };
  const resources = {
    requests: { cpu: params.cpuRequest, memory: params.memoryRequest },
    limits: { cpu: params.cpuLimit, memory: params.memoryLimit },
  };
  const baseMounts = (artifactReadOnly: boolean, scratchKey: string) => [
    { name: "submission-data", mountPath: "/submission", readOnly: true },
    { name: "artifact", mountPath: "/artifact", readOnly: artifactReadOnly },
    { name: "scratch-tmp", mountPath: "/tmp", subPath: scratchKey },
    { name: "scratch-workspace", mountPath: "/workspace", subPath: scratchKey },
  ];

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: params.jobName,
      namespace: params.namespace,
      labels: { app: "nojv-sandbox" },
    },
    spec: {
      ttlSecondsAfterFinished: TTL_AFTER_FINISHED_SECONDS,
      activeDeadlineSeconds: params.activeDeadlineSeconds,
      backoffLimit: 0,
      template: {
        metadata: { labels: { app: "nojv-sandbox", "nojv-role": "sandbox" } },
        spec: {
          restartPolicy: "Never",
          automountServiceAccountToken: false,
          nodeSelector: { "nojv-role": "sandbox" },
          tolerations: [
            { key: "nojv-role", operator: "Equal", value: "sandbox", effect: "NoSchedule" },
          ],
          securityContext: {
            runAsUser: 10001,
            runAsGroup: 10001,
            runAsNonRoot: true,
            seccompProfile: { type: "RuntimeDefault" },
          },
          initContainers: [
            {
              name: COMPILE_CONTAINER_NAME,
              image: params.image,
              command: ["node", "/runner/index.js"],
              env: [
                { name: "SANDBOX_PHASE", value: "compile" },
                { name: "HOME", value: "/tmp" },
              ],
              resources,
              securityContext: containerSecurityContext,
              volumeMounts: baseMounts(false, "compile"),
            },
          ],
          containers: params.caseIndices.map((index) => ({
            name: perCaseContainerName(index),
            image: params.image,
            command: ["node", "/runner/index.js"],
            env: [
              { name: "SANDBOX_PHASE", value: "run-case" },
              { name: "SANDBOX_CASE_INDEX", value: String(index) },
              { name: "PYTHONDONTWRITEBYTECODE", value: "1" },
              { name: "HOME", value: "/tmp" },
            ],
            resources,
            securityContext: containerSecurityContext,
            volumeMounts: baseMounts(true, perCaseContainerName(index)),
          })),
          volumes: [
            { name: "submission-data", configMap: { name: params.configMapName } },
            { name: "artifact", emptyDir: { sizeLimit: "256Mi" } },
            { name: "scratch-tmp", emptyDir: { sizeLimit: "64Mi" } },
            { name: "scratch-workspace", emptyDir: { sizeLimit: "128Mi" } },
          ],
        },
      },
    },
  };
}

export const INTERACTIVE_SOCKET_PORT = 7777;

export function buildSolutionContainerCommand(): string[] {
  return [
    "sh",
    "-c",
    `exec socat EXEC:"node /runner/index.js" TCP:127.0.0.1:${String(INTERACTIVE_SOCKET_PORT)},retry=40,interval=0.25`,
  ];
}

export function buildInteractorContainerCommand(): string[] {
  return [
    "sh",
    "-c",
    `exec socat TCP-LISTEN:${String(INTERACTIVE_SOCKET_PORT)},reuseaddr EXEC:"node /runner/index.js"`,
  ];
}

export interface InteractiveJobManifestParams {
  jobName: string;
  namespace: string;
  solutionConfigMapName: string;
  interactorConfigMapName: string;
  image: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  activeDeadlineSeconds: number;
}

export function buildInteractiveJobManifest(params: InteractiveJobManifestParams): k8s.V1Job {
  const containerSecurityContext = {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ["ALL"] },
    readOnlyRootFilesystem: true,
    runAsNonRoot: true,
  };
  const resources = {
    requests: { cpu: params.cpuRequest, memory: params.memoryRequest },
    limits: { cpu: params.cpuLimit, memory: params.memoryLimit },
  };

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: params.jobName,
      namespace: params.namespace,
      labels: { app: "nojv-sandbox" },
    },
    spec: {
      ttlSecondsAfterFinished: TTL_AFTER_FINISHED_SECONDS,
      activeDeadlineSeconds: params.activeDeadlineSeconds,
      backoffLimit: 0,
      template: {
        metadata: {
          labels: { app: "nojv-sandbox", "nojv-role": "sandbox" },
        },
        spec: {
          restartPolicy: "Never",
          automountServiceAccountToken: false,
          nodeSelector: { "nojv-role": "sandbox" },
          tolerations: [
            {
              key: "nojv-role",
              operator: "Equal",
              value: "sandbox",
              effect: "NoSchedule",
            },
          ],
          securityContext: {
            runAsUser: 10001,
            runAsGroup: 10001,
            runAsNonRoot: true,
            seccompProfile: { type: "RuntimeDefault" },
          },
          containers: [
            {
              name: "solution",
              image: params.image,
              command: buildSolutionContainerCommand(),
              resources,
              securityContext: containerSecurityContext,
              volumeMounts: [
                { name: "solution-data", mountPath: "/submission", readOnly: true },
                { name: "solution-workspace", mountPath: "/workspace" },
                { name: "solution-tmp", mountPath: "/tmp" },
              ],
            },
            {
              name: "interactor",
              image: params.image,
              command: buildInteractorContainerCommand(),
              resources,
              securityContext: containerSecurityContext,
              volumeMounts: [
                { name: "interactor-data", mountPath: "/submission", readOnly: true },
                { name: "interactor-workspace", mountPath: "/workspace" },
                { name: "interactor-tmp", mountPath: "/tmp" },
              ],
            },
          ],
          volumes: [
            {
              name: "solution-data",
              configMap: { name: params.solutionConfigMapName },
            },
            {
              name: "interactor-data",
              configMap: { name: params.interactorConfigMapName },
            },
            { name: "solution-workspace", emptyDir: { sizeLimit: "128Mi" } },
            { name: "solution-tmp", emptyDir: { sizeLimit: "64Mi" } },
            { name: "interactor-workspace", emptyDir: { sizeLimit: "128Mi" } },
            { name: "interactor-tmp", emptyDir: { sizeLimit: "64Mi" } },
          ],
        },
      },
    },
  };
}

export interface K8sClientHandles {
  coreApi: k8s.CoreV1Api;
  batchApi: k8s.BatchV1Api;
}

function validatorOutcomesSeForAll(rawRuns: RawCaseRun[]): Map<number, ValidatorOutcome> {
  return new Map(
    rawRuns
      .filter((r) => !r.errorVerdict)
      .map((r): [number, ValidatorOutcome] => [r.index, { verdict: "SE" }]),
  );
}

function parseValidatorOutcomesFromLogs(
  logs: string,
  rawRuns: RawCaseRun[],
): Map<number, ValidatorOutcome> | null {
  const lines = logs.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]?.trim();
    if (!trimmed?.startsWith("{")) continue;
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parsed = parseValidateOutput(json);
    if (!parsed.success || parsed.data.validatorOutcomes === undefined) continue;

    const outcomes = new Map<number, ValidatorOutcome>();
    for (const o of parsed.data.validatorOutcomes) {
      const { index, ...rest } = o;
      outcomes.set(index, rest);
    }
    for (const r of rawRuns) {
      if (!r.errorVerdict && !outcomes.has(r.index)) {
        outcomes.set(r.index, { verdict: "SE" });
      }
    }
    return outcomes;
  }

  return null;
}

function parseCompilationError(logs: string): string | null {
  const lines = logs.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = (lines[i] ?? "").trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as { compilationError?: unknown };
      return typeof parsed.compilationError === "string" ? parsed.compilationError : null;
    } catch {
      continue;
    }
  }
  return null;
}

export class K8sExecutor implements SandboxExecutor {
  private readonly coreApi: k8s.CoreV1Api;
  private readonly batchApi: k8s.BatchV1Api;

  constructor(
    private readonly config: K8sExecutorConfig,
    clients?: K8sClientHandles,
  ) {
    if (clients) {
      this.coreApi = clients.coreApi;
      this.batchApi = clients.batchApi;
      return;
    }
    const k8sLib = require("@kubernetes/client-node") as typeof k8s;
    const kc = new k8sLib.KubeConfig();
    kc.loadFromCluster();
    this.coreApi = kc.makeApiClient(k8sLib.CoreV1Api);
    this.batchApi = kc.makeApiClient(k8sLib.BatchV1Api);
  }

  async execute(request: SandboxRequest): Promise<SandboxResult> {
    if (request.advanced) {
      return this.executeAdvanced(request);
    }

    if (request.judgeType === "interactive") {
      return this.executeInteractive(request);
    }

    if (request.judgeType === "checker") {
      return this.executeChecker(request);
    }

    return this.executeRunOnly(request);
  }

  private async executeAdvanced(request: SandboxRequest): Promise<SandboxResult> {
    const advanced = request.advanced;
    if (!advanced) return sandboxSystemError("advanced-mode dispatch called without payload");

    if (advanced.grade.imageSource === "tarball") {
      const message =
        "Advanced tarball-source images require the Docker backend; push the image to a registry the cluster can pull and switch the problem to 'registry' source, or run advanced workloads on the Docker backend.";
      logger.error("K8s executor refused advanced tarball-source submission", {
        submissionId: request.submissionId,
      });
      return advancedFallbackResult(request, message);
    }

    const jobName = `judge-${request.submissionId}`;
    const ns = this.config.namespace;
    const configMapName = `${jobName}-input`;

    try {
      await this.createConfigMap(configMapName, ns, buildAdvancedConfigMapData(request));
      await this.batchApi.createNamespacedJob({
        namespace: ns,
        body: buildAdvancedJobManifest({
          jobName,
          namespace: ns,
          configMapName,
          sandboxImage: this.config.image,
          graderImage: advanced.grade.imageRef,
          memoryMb: advanced.memoryMb,
          totalTimeMs: advanced.totalTimeMs,
          cpuLimit: this.config.cpuLimit,
          submissionId: request.submissionId,
          language: request.language,
        }),
      });

      await this.waitForJobCompletion(jobName, ns, Math.ceil(advanced.totalTimeMs / 1000) + 30);
      const podName = await this.findPodName(jobName, ns);
      if (!podName) {
        return advancedFallbackResult(request, "Advanced sandbox produced no pod.");
      }

      const sidecarLog = await this.coreApi
        .readNamespacedPodLog({
          name: podName,
          namespace: ns,
          container: ADVANCED_SIDECAR_NAME,
        })
        .catch(() => "");

      const raw = parseAdvancedResultLog(sidecarLog);
      if (raw === null) {
        return advancedFallbackResult(
          request,
          "Advanced sandbox sidecar produced no result marker.",
        );
      }

      if (raw && typeof raw === "object" && (raw as { missing?: boolean }).missing === true) {
        return advancedFallbackResult(
          request,
          "Advanced judge image did not write result.json before the deadline.",
        );
      }

      const parsed = advancedResultSchema.safeParse(raw);
      if (!parsed.success) {
        return advancedFallbackResult(
          request,
          `Invalid result.json: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
        );
      }

      return mapAdvancedResult(request, parsed.data);
    } catch (err) {
      logger.error("K8s advanced execution failed", {
        submissionId: request.submissionId,
        jobName,
        err: err instanceof Error ? err.message : String(err),
      });
      return advancedFallbackResult(
        request,
        `Advanced sandbox failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await this.cleanupJob(jobName, ns);
      await this.cleanupConfigMap(configMapName, ns);
    }
  }

  private async executeInteractive(request: SandboxRequest): Promise<SandboxResult> {
    if (!request.judgeConfig.interactorScript) {
      return sandboxSystemError("Interactive judge is missing its interactor script.");
    }

    const ns = this.config.namespace;
    const baseName = `judge-${request.submissionId}`;
    const results: SandboxTestcaseResult[] = [];

    for (const testcase of request.testcases) {
      results.push(await this.runInteractiveCase(baseName, ns, request, testcase));
    }

    return { testcaseResults: results };
  }

  private async runInteractiveCase(
    baseName: string,
    namespace: string,
    request: SandboxRequest,
    testcase: SandboxTestcase,
  ): Promise<SandboxTestcaseResult> {
    const jobName = `${baseName}-int-${String(testcase.index)}`;
    const solConfigMap = `${jobName}-sol`;
    const intConfigMap = `${jobName}-int`;

    const seCase = (message: string): SandboxTestcaseResult => ({
      index: testcase.index,
      verdict: "SE",
      stdout: "",
      stderr: message,
      exitCode: -1,
      timeMs: 0,
      feedback: message,
    });

    try {
      await this.createConfigMap(
        solConfigMap,
        namespace,
        buildInteractiveSolutionConfigMapData(request),
      );
      await this.createConfigMap(
        intConfigMap,
        namespace,
        buildInteractiveInteractorConfigMapData(request, testcase),
      );

      const deadlineSeconds = Math.ceil(request.limits.timeoutMs / 1000) + 30;
      await this.batchApi.createNamespacedJob({
        namespace,
        body: buildInteractiveJobManifest({
          jobName,
          namespace,
          solutionConfigMapName: solConfigMap,
          interactorConfigMapName: intConfigMap,
          image: this.config.image,
          cpuRequest: this.config.cpuRequest,
          cpuLimit: this.config.cpuLimit,
          memoryRequest: this.config.memoryRequest,
          memoryLimit: this.config.memoryLimit,
          activeDeadlineSeconds: deadlineSeconds,
        }),
      });

      const outcome = await this.waitForJobCompletion(jobName, namespace, deadlineSeconds);
      const podName = await this.findPodName(jobName, namespace);
      if (!podName) {
        if (outcome === "failed") return seCase("Interactive sandbox job failed or timed out.");
        return seCase("Interactive sandbox produced no pod.");
      }

      const [solLogs, intLogs] = await Promise.all([
        this.coreApi
          .readNamespacedPodLog({ name: podName, namespace, container: "solution" })
          .catch(() => ""),
        this.coreApi
          .readNamespacedPodLog({ name: podName, namespace, container: "interactor" })
          .catch(() => ""),
      ]);

      const sol: InteractiveSideResult = {
        stderr: solLogs,
        timedOut: false,
        spawnError: false,
      };
      const int: InteractiveSideResult = {
        stderr: intLogs,
        timedOut: false,
        spawnError: false,
      };
      return mergeInteractiveCase(testcase, sol, int);
    } catch (err) {
      logger.error("K8s interactive case failed", {
        submissionId: request.submissionId,
        jobName,
        index: testcase.index,
        err: err instanceof Error ? err.message : String(err),
      });
      return seCase("Interactive sandbox failed to start.");
    } finally {
      await this.cleanupJob(jobName, namespace);
      await this.cleanupConfigMap(solConfigMap, namespace);
      await this.cleanupConfigMap(intConfigMap, namespace);
    }
  }

  private async cleanupJob(name: string, namespace: string): Promise<void> {
    await this.batchApi
      .deleteNamespacedJob({
        name,
        namespace,
        propagationPolicy: "Background",
      })
      .catch(() => undefined);
  }

  private async findPodName(jobName: string, namespace: string): Promise<string | null> {
    try {
      const pods = await this.coreApi.listNamespacedPod({
        namespace,
        labelSelector: `job-name=${jobName}`,
      });
      return pods.items[0]?.metadata?.name ?? null;
    } catch {
      return null;
    }
  }

  private async cleanupConfigMap(name: string, namespace: string): Promise<void> {
    await this.coreApi.deleteNamespacedConfigMap({ name, namespace }).catch(() => undefined);
  }

  private async runPerCasePod(request: SandboxRequest): Promise<SandboxResult> {
    const jobName = `judge-${request.submissionId}`;
    const ns = this.config.namespace;
    const caseIndices = request.testcases.map((tc) => tc.index);

    if (caseIndices.length === 0) return { testcaseResults: [] };

    try {
      const deadlineSeconds = computeJobDeadlineSeconds(request);
      await this.createConfigMap(jobName, ns, buildRunConfigMapData(request));
      await this.createPerCaseJob(jobName, ns, jobName, deadlineSeconds, caseIndices);

      await this.waitForJobCompletion(jobName, ns, deadlineSeconds);

      const compileLog = await this.getContainerLogs(jobName, ns, COMPILE_CONTAINER_NAME);
      const compileError = parseCompilationError(compileLog);
      if (compileError) return { testcaseResults: [], compilationError: compileError };

      const rawRuns: RawCaseRun[] = [];
      for (const index of caseIndices) {
        const logs = await this.getContainerLogs(jobName, ns, perCaseContainerName(index));
        const parsed = logs ? this.parseRunnerOutput(logs) : null;
        const run = parsed?.rawRuns?.[0];
        rawRuns.push(
          run ?? {
            index,
            stdout: "",
            stderr: parsed?.pipelineError ?? "Case container produced no result.",
            exitCode: -1,
            timeMs: 0,
            errorVerdict: "SE",
          },
        );
      }
      return { testcaseResults: [], rawRuns };
    } finally {
      await this.cleanup(jobName, ns);
    }
  }

  private async executeRunOnly(request: SandboxRequest): Promise<SandboxResult> {
    const result = await this.runPerCasePod(request);
    return resolveSandboxResult(result, request.testcases, request.judgeConfig.compare);
  }

  private async executeChecker(request: SandboxRequest): Promise<SandboxResult> {
    const validateName = `judge-${request.submissionId}-validate`;
    const ns = this.config.namespace;

    const runResult = await this.runPerCasePod(request);
    if (!runResult.rawRuns) return runResult;
    const rawRuns = runResult.rawRuns;

    try {
      const hasGradableCase = rawRuns.some((r) => !r.errorVerdict);
      const outcomes = hasGradableCase
        ? await this.runValidateJob(validateName, ns, request, rawRuns)
        : new Map<number, ValidatorOutcome>();

      return { testcaseResults: mergeCheckerResults(rawRuns, outcomes) };
    } finally {
      await this.cleanup(validateName, ns);
    }
  }

  private async runValidateJob(
    jobName: string,
    namespace: string,
    request: SandboxRequest,
    rawRuns: RawCaseRun[],
  ): Promise<Map<number, ValidatorOutcome>> {
    try {
      const deadlineSeconds = computeJobDeadlineSeconds(request);
      await this.createConfigMap(
        jobName,
        namespace,
        buildValidateConfigMapData(request, rawRuns),
      );
      await this.createJob(jobName, namespace, jobName, deadlineSeconds);

      const outcome = await this.waitForJobCompletion(jobName, namespace, deadlineSeconds);
      if (outcome === "failed") return validatorOutcomesSeForAll(rawRuns);

      const logs = await this.getPodLogs(jobName, namespace);
      return (
        parseValidatorOutcomesFromLogs(logs, rawRuns) ?? validatorOutcomesSeForAll(rawRuns)
      );
    } catch (err) {
      logger.error("K8s validate Job failed", {
        submissionId: request.submissionId,
        jobName,
        err: err instanceof Error ? err.message : String(err),
      });
      return validatorOutcomesSeForAll(rawRuns);
    }
  }

  private async createConfigMap(
    name: string,
    namespace: string,
    data: Record<string, string>,
  ): Promise<void> {
    const totalBytes = Object.entries(data).reduce(
      (sum, [key, value]) => sum + Buffer.byteLength(key) + Buffer.byteLength(value),
      0,
    );
    if (totalBytes > CONFIGMAP_MAX_BYTES) {
      throw new Error(
        `ConfigMap ${name} payload is ${String(totalBytes)} bytes, exceeding the ${String(CONFIGMAP_MAX_BYTES)}-byte limit; testcase data is too large for ConfigMap delivery.`,
      );
    }
    await this.coreApi.createNamespacedConfigMap({
      namespace,
      body: {
        metadata: { name, namespace },
        data,
      },
    });
  }

  private async createJob(
    jobName: string,
    namespace: string,
    configMapName: string,
    deadlineSeconds: number,
  ): Promise<void> {
    await this.batchApi.createNamespacedJob({
      namespace,
      body: buildSandboxJobManifest({
        jobName,
        namespace,
        configMapName,
        image: this.config.image,
        cpuRequest: this.config.cpuRequest,
        cpuLimit: this.config.cpuLimit,
        memoryRequest: this.config.memoryRequest,
        memoryLimit: this.config.memoryLimit,
        activeDeadlineSeconds: deadlineSeconds,
      }),
    });
  }

  private async createPerCaseJob(
    jobName: string,
    namespace: string,
    configMapName: string,
    deadlineSeconds: number,
    caseIndices: number[],
  ): Promise<void> {
    await this.batchApi.createNamespacedJob({
      namespace,
      body: buildPerCaseSandboxJobManifest({
        jobName,
        namespace,
        configMapName,
        image: this.config.image,
        cpuRequest: this.config.cpuRequest,
        cpuLimit: this.config.cpuLimit,
        memoryRequest: this.config.memoryRequest,
        memoryLimit: this.config.memoryLimit,
        activeDeadlineSeconds: deadlineSeconds,
        caseIndices,
      }),
    });
  }

  private async waitForJobCompletion(
    jobName: string,
    namespace: string,
    deadlineSeconds: number,
  ): Promise<"succeeded" | "failed"> {
    const deadline = Date.now() + (deadlineSeconds + JOB_DEADLINE_BUFFER_SECONDS) * 1_000;

    while (Date.now() < deadline) {
      const job = await this.batchApi.readNamespacedJob({
        name: jobName,
        namespace,
      });

      if (job.status?.succeeded) return "succeeded";
      if (job.status?.failed) return "failed";

      await new Promise((r) => setTimeout(r, JOB_POLL_INTERVAL_MS));
    }

    return "failed";
  }

  private async getPodLogs(jobName: string, namespace: string): Promise<string> {
    return this.getContainerLogs(jobName, namespace, "runner");
  }

  private async getContainerLogs(
    jobName: string,
    namespace: string,
    container: string,
  ): Promise<string> {
    const pods = await this.coreApi.listNamespacedPod({
      namespace,
      labelSelector: `job-name=${jobName}`,
    });

    const podName = pods.items[0]?.metadata?.name;
    if (!podName) {
      throw new Error(`No pod found for job ${jobName}`);
    }

    return this.coreApi
      .readNamespacedPodLog({ container, name: podName, namespace })
      .catch(() => "");
  }

  private parseRunnerOutput(logs: string): SandboxResult | null {
    const lines = logs.trim().split("\n");

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;

      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;

      try {
        const parsed = parseSandboxResult(JSON.parse(trimmed));
        if (parsed.success) return parsed.data;
      } catch {
        continue;
      }
    }

    return null;
  }

  private async cleanup(jobName: string, namespace: string): Promise<void> {
    await this.coreApi
      .deleteNamespacedConfigMap({
        name: jobName,
        namespace,
      })
      .catch(() => undefined);

    await this.batchApi
      .deleteNamespacedJob({
        name: jobName,
        namespace,
        propagationPolicy: "Background",
      })
      .catch(() => undefined);
  }
}
