import { createRequire } from "node:module";

import type * as k8s from "@kubernetes/client-node";

const require = createRequire(import.meta.url);

import type {
  SandboxExecutor,
  SandboxRequest,
  SandboxResult,
} from "./sandbox-executor.js";

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

/** Map language to source file extension for ConfigMap keys. */
function sourceExtension(
  language: SandboxRequest["language"],
): string {
  switch (language) {
    case "c":
      return "c";
    case "cpp":
      return "cpp";
    case "go":
      return "go";
    case "java":
      return "java";
    case "javascript":
      return "mjs";
    case "python":
      return "py";
    case "rust":
      return "rs";
    case "typescript":
      return "ts";
  }
}

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
        return {
          testcaseResults: [
            {
              index: 0,
              verdict: "SE",
              stdout: "",
              stderr: "Sandbox job failed or timed out.",
              exitCode: -1,
              timeMs: 0,
            },
          ],
        };
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
    request: SandboxRequest,
  ): Promise<void> {
    const data: Record<string, string> = {};

    // Judge config
    data["config.json"] = JSON.stringify({
      submissionId: request.submissionId,
      language: request.language,
      judgeType: request.judgeType,
      submissionType: request.submissionType,
      limits: request.limits,
      ...(request.template ? { template: request.template } : {}),
      ...(request.judgeConfig.checkerLanguage
        ? { checkerLanguage: request.judgeConfig.checkerLanguage }
        : {}),
    });

    // Source code
    const ext = sourceExtension(request.language);
    data[`source.${ext}`] = request.sourceCode;

    // Checker / interactor scripts (if applicable)
    if (request.judgeConfig.checkerScript) {
      const checkerExt = request.judgeConfig.checkerLanguage === "cpp"
        ? "cpp"
        : request.judgeConfig.checkerLanguage === "c"
          ? "c"
          : "py";
      data[`checker.${checkerExt}`] = request.judgeConfig.checkerScript;
    }

    if (request.judgeConfig.interactorScript) {
      data["interactor.py"] = request.judgeConfig.interactorScript;
    }

    // Testcase data as flat keys
    for (const tc of request.testcases) {
      data[`testcase-${String(tc.index)}-input.txt`] = tc.input;
      if (tc.expected != null) {
        data[`testcase-${String(tc.index)}-expected.txt`] = tc.expected;
      }
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
  ): Promise<void> {
    await this.batchApi.createNamespacedJob({
      namespace,
      body: {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: {
          name: jobName,
          namespace,
          labels: { app: "nojv-sandbox" },
        },
        spec: {
          ttlSecondsAfterFinished: TTL_AFTER_FINISHED_SECONDS,
          activeDeadlineSeconds: JOB_DEADLINE_SECONDS,
          backoffLimit: 0,
          template: {
            spec: {
              restartPolicy: "Never",
              automountServiceAccountToken: false,
              securityContext: {
                runAsUser: 10001,
                runAsGroup: 10001,
                seccompProfile: { type: "RuntimeDefault" },
              },
              containers: [
                {
                  name: "runner",
                  image: this.config.image,
                  command: ["node", "/runner/index.js"],
                  resources: {
                    requests: {
                      cpu: this.config.cpuRequest,
                      memory: this.config.memoryRequest,
                    },
                    limits: {
                      cpu: this.config.cpuLimit,
                      memory: this.config.memoryLimit,
                    },
                  },
                  securityContext: {
                    allowPrivilegeEscalation: false,
                    capabilities: { drop: ["ALL"] },
                    readOnlyRootFilesystem: true,
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
                  configMap: { name: jobName },
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
      },
    });
  }

  private async waitForJobCompletion(
    jobName: string,
    namespace: string,
  ): Promise<"succeeded" | "failed"> {
    const deadline = Date.now() + JOB_DEADLINE_SECONDS * 1_000;

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

  private async getPodLogs(
    jobName: string,
    namespace: string,
  ): Promise<string> {
    const pods = await this.coreApi.listNamespacedPod({
      namespace,
      labelSelector: `job-name=${jobName}`,
    });

    const podName = pods.items[0]?.metadata?.name;
    if (!podName) {
      throw new Error(`No pod found for job ${jobName}`);
    }

    return this.coreApi.readNamespacedPodLog({
      container: "runner",
      name: podName,
      namespace,
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
          return JSON.parse(trimmed) as SandboxResult;
        } catch {
          // Not valid JSON, keep searching
        }
      }
    }

    return {
      testcaseResults: [
        {
          index: 0,
          verdict: "SE",
          stdout: logs,
          stderr: "Failed to parse sandbox runner output.",
          exitCode: -1,
          timeMs: 0,
        },
      ],
    };
  }

  private async cleanup(
    jobName: string,
    namespace: string,
  ): Promise<void> {
    // Delete ConfigMap; Job auto-cleans via ttlSecondsAfterFinished.
    try {
      await this.coreApi.deleteNamespacedConfigMap({
        name: jobName,
        namespace,
      });
    } catch {
      // Best-effort cleanup; ignore errors
    }

    // Also attempt to delete the Job in case TTL controller is slow
    try {
      await this.batchApi.deleteNamespacedJob({
        name: jobName,
        namespace,
        propagationPolicy: "Background",
      });
    } catch {
      // Best-effort cleanup; ignore errors
    }
  }
}
