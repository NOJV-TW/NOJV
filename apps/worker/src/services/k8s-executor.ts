import { createRequire } from "node:module";

import type * as k8s from "@kubernetes/client-node";

const require = createRequire(import.meta.url);

import {
  normalizeRelativePath,
  sourceFileNames,
  type SandboxExecutor,
  type SandboxRequest,
  type SandboxResult
} from "@nojv/core";
import { parseSandboxResult } from "./sandbox-schema";
import { buildSandboxConfigJson, sandboxSystemError, sourceExtension } from "./sandbox-plan";

export interface K8sExecutorConfig {
  namespace: string;
  image: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
}

const JOB_DEADLINE_SECONDS = 120;
const JOB_POLL_INTERVAL_MS = 1_000;
const TTL_AFTER_FINISHED_SECONDS = 60;

export class K8sExecutor implements SandboxExecutor {
  private coreApi: k8s.CoreV1Api;
  private batchApi: k8s.BatchV1Api;

  constructor(private config: K8sExecutorConfig) {
    // Lazy-import avoids loading @kubernetes/client-node when DockerExecutor is used (local dev).
    const k8sLib = require("@kubernetes/client-node") as typeof k8s;
    const kc = new k8sLib.KubeConfig();
    kc.loadFromCluster();
    this.coreApi = kc.makeApiClient(k8sLib.CoreV1Api);
    this.batchApi = kc.makeApiClient(k8sLib.BatchV1Api);
  }

  async execute(request: SandboxRequest): Promise<SandboxResult> {
    const jobName = `judge-${request.submissionId}`;
    const ns = this.config.namespace;

    try {
      await this.createConfigMap(jobName, ns, request);
      await this.createJob(jobName, ns);

      const outcome = await this.waitForJobCompletion(jobName, ns);
      if (outcome === "failed") {
        return sandboxSystemError("Sandbox job failed or timed out.");
      }

      const logs = await this.getPodLogs(jobName, ns);
      return this.parseRunnerOutput(logs);
    } finally {
      await this.cleanup(jobName, ns);
    }
  }

  /**
   * Build a flat ConfigMap with submission data.
   *
   * ConfigMaps don't support nested directories, so testcases are stored
   * as flat keys: `testcase-{i}-input.txt`, `testcase-{i}-expected.txt`.
   * The sandbox runner must handle both directory layout (Docker volume
   * mount) and flat ConfigMap keys (K8s).
   */
  private async createConfigMap(
    name: string,
    namespace: string,
    request: SandboxRequest
  ): Promise<void> {
    const data: Record<string, string> = {};
    const sourceFileMap: { path: string; key: string }[] = [];
    const mainSourceName = sourceFileNames[request.language];
    let wroteMainSource = false;

    // Source code and optional project files
    for (const sourceFile of request.sourceFiles ?? []) {
      const normalizedPath = normalizeRelativePath(sourceFile.path);
      if (!normalizedPath) {
        continue;
      }

      if (normalizedPath === mainSourceName) {
        wroteMainSource = true;
      }

      const key = `source-file-${String(sourceFileMap.length)}`;
      data[key] = sourceFile.content;
      sourceFileMap.push({ path: normalizedPath, key });
    }

    if (!wroteMainSource) {
      data[mainSourceName] = request.sourceCode;
    }

    data["config.json"] = JSON.stringify(buildSandboxConfigJson(request, sourceFileMap));

    if (request.judgeConfig.checkerScript) {
      const ext = sourceExtension(request.judgeConfig.checkerLanguage);
      data[`checker.${ext}`] = request.judgeConfig.checkerScript;
    }

    if (request.judgeConfig.interactorScript) {
      const ext = sourceExtension(request.judgeConfig.interactorLanguage);
      data[`interactor.${ext}`] = request.judgeConfig.interactorScript;
    }

    // Testcase data as flat keys
    for (const tc of request.testcases) {
      data[`testcase-${String(tc.index)}-input.txt`] = tc.input;
      if (tc.output != null) {
        data[`testcase-${String(tc.index)}-expected.txt`] = tc.output;
      }
    }

    await this.coreApi.createNamespacedConfigMap({
      namespace,
      body: {
        metadata: { name, namespace },
        data
      }
    });
  }

  private async createJob(jobName: string, namespace: string): Promise<void> {
    await this.batchApi.createNamespacedJob({
      namespace,
      body: {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: {
          name: jobName,
          namespace,
          labels: { app: "nojv-sandbox" }
        },
        spec: {
          ttlSecondsAfterFinished: TTL_AFTER_FINISHED_SECONDS,
          activeDeadlineSeconds: JOB_DEADLINE_SECONDS,
          backoffLimit: 0,
          template: {
            // The `app: nojv-sandbox` label here (NOT on the Job metadata) is
            // what the sandbox NetworkPolicy podSelector matches — Job labels
            // do not propagate to the pod template.
            metadata: {
              labels: { app: "nojv-sandbox", "nojv-role": "sandbox" }
            },
            spec: {
              restartPolicy: "Never",
              automountServiceAccountToken: false,
              // Sandbox pods only land on the untrusted-code node pool, which
              // is tainted `nojv-role=sandbox:NoSchedule` so nothing else runs
              // there. Keeps a runaway fork-bomb from starving the orchestrator.
              nodeSelector: { "nojv-role": "sandbox" },
              tolerations: [
                {
                  key: "nojv-role",
                  operator: "Equal",
                  value: "sandbox",
                  effect: "NoSchedule"
                }
              ],
              securityContext: {
                runAsUser: 10001,
                runAsGroup: 10001,
                seccompProfile: { type: "RuntimeDefault" }
              },
              containers: [
                {
                  name: "runner",
                  image: this.config.image,
                  command: ["node", "/runner/index.js"],
                  resources: {
                    requests: {
                      cpu: this.config.cpuRequest,
                      memory: this.config.memoryRequest
                    },
                    limits: {
                      cpu: this.config.cpuLimit,
                      memory: this.config.memoryLimit
                    }
                  },
                  securityContext: {
                    allowPrivilegeEscalation: false,
                    capabilities: { drop: ["ALL"] },
                    readOnlyRootFilesystem: true
                  },
                  volumeMounts: [
                    {
                      name: "submission-data",
                      mountPath: "/submission",
                      readOnly: true
                    },
                    { name: "workspace", mountPath: "/workspace" },
                    { name: "tmp", mountPath: "/tmp" }
                  ]
                }
              ],
              volumes: [
                {
                  name: "submission-data",
                  configMap: { name: jobName }
                },
                {
                  name: "workspace",
                  emptyDir: { sizeLimit: "128Mi" }
                },
                {
                  name: "tmp",
                  emptyDir: { sizeLimit: "64Mi" }
                }
              ]
            }
          }
        }
      }
    });
  }

  private async waitForJobCompletion(
    jobName: string,
    namespace: string
  ): Promise<"succeeded" | "failed"> {
    const deadline = Date.now() + JOB_DEADLINE_SECONDS * 1_000;

    while (Date.now() < deadline) {
      const job = await this.batchApi.readNamespacedJob({
        name: jobName,
        namespace
      });

      if (job.status?.succeeded) return "succeeded";
      if (job.status?.failed) return "failed";

      await new Promise((r) => setTimeout(r, JOB_POLL_INTERVAL_MS));
    }

    return "failed";
  }

  private async getPodLogs(jobName: string, namespace: string): Promise<string> {
    const pods = await this.coreApi.listNamespacedPod({
      namespace,
      labelSelector: `job-name=${jobName}`
    });

    const podName = pods.items[0]?.metadata?.name;
    if (!podName) {
      throw new Error(`No pod found for job ${jobName}`);
    }

    return this.coreApi.readNamespacedPodLog({
      container: "runner",
      name: podName,
      namespace
    });
  }

  private parseRunnerOutput(logs: string): SandboxResult {
    // The sandbox runner writes a single JSON object to stdout as its
    // last output. Find the last line that looks like JSON.
    const lines = logs.trim().split("\n");

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) {
        continue;
      }

      const trimmed = line.trim();
      if (trimmed.startsWith("{")) {
        try {
          const parsed = parseSandboxResult(JSON.parse(trimmed));
          if (parsed.success) return parsed.data;
        } catch {
          // Not valid JSON, keep searching
        }
      }
    }

    return sandboxSystemError("Failed to parse sandbox runner output.", logs);
  }

  private async cleanup(jobName: string, namespace: string): Promise<void> {
    // Delete ConfigMap; Job auto-cleans via ttlSecondsAfterFinished.
    try {
      await this.coreApi.deleteNamespacedConfigMap({
        name: jobName,
        namespace
      });
    } catch {
      // Best-effort cleanup; ignore errors
    }

    // Also attempt to delete the Job in case TTL controller is slow
    try {
      await this.batchApi.deleteNamespacedJob({
        name: jobName,
        namespace,
        propagationPolicy: "Background"
      });
    } catch {
      // Best-effort cleanup; ignore errors
    }
  }
}
